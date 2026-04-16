import time
import sys
from sqlalchemy.exc import OperationalError
from sqlalchemy import inspect, text
from app import app, db


def ensure_schema_updates():
    inspector = inspect(db.engine)

    tables = set(inspector.get_table_names())

    def ensure_index(table_name, index_name, ddl):
        existing_indexes = {index['name'] for index in inspector.get_indexes(table_name)}
        if index_name in existing_indexes:
            return

        print(f"检测到 {table_name} 缺少索引 {index_name}，正在补齐...")
        db.session.execute(text(ddl))
        db.session.commit()

    if 'question' in tables:
        question_columns = {column['name'] for column in inspector.get_columns('question')}
        if 'review_status' not in question_columns:
            print("检测到 question 缺少 review_status，正在补齐...")
            db.session.execute(text("ALTER TABLE question ADD COLUMN review_status VARCHAR(20) NOT NULL DEFAULT 'approved'"))
            db.session.commit()

        ensure_index(
            'question',
            'idx_question_public_review_created',
            "CREATE INDEX idx_question_public_review_created ON question (is_public, review_status, created_at)"
        )
        ensure_index(
            'question',
            'idx_question_counselor_created',
            "CREATE INDEX idx_question_counselor_created ON question (counselor_id, created_at)"
        )
        ensure_index(
            'question',
            'idx_question_user_created',
            "CREATE INDEX idx_question_user_created ON question (user_id, created_at)"
        )

    if 'reply' in tables:
        reply_columns = {column['name'] for column in inspector.get_columns('reply')}
        if 'audit_status' not in reply_columns:
            print("检测到 reply 缺少 audit_status，正在补齐...")
            db.session.execute(text("ALTER TABLE reply ADD COLUMN audit_status VARCHAR(20) NOT NULL DEFAULT 'passed'"))
            db.session.commit()
        if 'audit_checked_at' not in reply_columns:
            print("检测到 reply 缺少 audit_checked_at，正在补齐...")
            db.session.execute(text("ALTER TABLE reply ADD COLUMN audit_checked_at DATETIME NULL"))
            db.session.commit()

        ensure_index(
            'reply',
            'idx_reply_question_created',
            "CREATE INDEX idx_reply_question_created ON reply (question_id, created_at)"
        )

    if 'teacher_profile' in tables:
        teacher_profile_columns = {column['name'] for column in inspector.get_columns('teacher_profile')}
        if 'last_checked_at' not in teacher_profile_columns:
            print("检测到 teacher_profile 缺少 last_checked_at，正在补齐...")
            db.session.execute(text("ALTER TABLE teacher_profile ADD COLUMN last_checked_at DATETIME NULL"))
            db.session.commit()

    if 'user' in tables:
        user_columns = {column['name'] for column in inspector.get_columns('user')}
        if 'wechat_id' not in user_columns:
            print("检测到 user 缺少 wechat_id，正在补齐...")
            db.session.execute(text("ALTER TABLE user ADD COLUMN wechat_id VARCHAR(64) NULL"))
            db.session.commit()
        if 'admin_level' not in user_columns:
            print("检测到 user 缺少 admin_level，正在补齐...")
            db.session.execute(text("ALTER TABLE user ADD COLUMN admin_level VARCHAR(20) NOT NULL DEFAULT 'none'"))
            db.session.commit()

        ensure_index(
            'user',
            'idx_user_wechat_id',
            "CREATE INDEX idx_user_wechat_id ON user (wechat_id)"
        )

    if 'appointment' in tables:
        appointment_columns = {column['name'] for column in inspector.get_columns('appointment')}
        if 'cancelled_at' not in appointment_columns:
            print("检测到 appointment 缺少 cancelled_at，正在补齐...")
            db.session.execute(text("ALTER TABLE appointment ADD COLUMN cancelled_at DATETIME NULL"))
            db.session.commit()
        if 'cancelled_by_user_id' not in appointment_columns:
            print("检测到 appointment 缺少 cancelled_by_user_id，正在补齐...")
            db.session.execute(text("ALTER TABLE appointment ADD COLUMN cancelled_by_user_id INTEGER NULL"))
            db.session.commit()
        if 'cancel_reason' not in appointment_columns:
            print("检测到 appointment 缺少 cancel_reason，正在补齐...")
            db.session.execute(text("ALTER TABLE appointment ADD COLUMN cancel_reason VARCHAR(255) NULL"))
            db.session.commit()

        ensure_index(
            'appointment',
            'idx_appointment_user_date_status',
            "CREATE INDEX idx_appointment_user_date_status ON appointment (user_id, appointment_date, status)"
        )
        ensure_index(
            'appointment',
            'idx_appointment_teacher_date_status',
            "CREATE INDEX idx_appointment_teacher_date_status ON appointment (teacher_id, appointment_date, status)"
        )

    if 'teacher_invite' not in tables:
        print("检测到 teacher_invite 表不存在，将由 create_all 创建。")
    else:
        teacher_invite_columns = {column['name'] for column in inspector.get_columns('teacher_invite')}
        if 'claim_token' not in teacher_invite_columns:
            print("检测到 teacher_invite 缺少 claim_token，正在补齐...")
            db.session.execute(text("ALTER TABLE teacher_invite ADD COLUMN claim_token VARCHAR(64) NULL"))
            db.session.commit()

        ensure_index(
            'teacher_invite',
            'idx_teacher_invite_claim_token',
            "CREATE INDEX idx_teacher_invite_claim_token ON teacher_invite (claim_token)"
        )

    if 'admin_application' not in tables:
        print("检测到 admin_application 表不存在，将由 create_all 创建。")

    if 'admin_invitation' not in tables:
        print("检测到 admin_invitation 表不存在，将由 create_all 创建。")
    else:
        admin_invitation_columns = {column['name'] for column in inspector.get_columns('admin_invitation')}
        if 'invitation_type' not in admin_invitation_columns:
            print("检测到 admin_invitation 缺少 invitation_type，正在补齐...")
            db.session.execute(text("ALTER TABLE admin_invitation ADD COLUMN invitation_type VARCHAR(20) NOT NULL DEFAULT 'wechat_id'"))
            db.session.commit()
        if 'claim_token' not in admin_invitation_columns:
            print("检测到 admin_invitation 缺少 claim_token，正在补齐...")
            db.session.execute(text("ALTER TABLE admin_invitation ADD COLUMN claim_token VARCHAR(64) NULL"))
            db.session.commit()

        ensure_index(
            'admin_invitation',
            'idx_admin_invitation_claim_token',
            "CREATE INDEX idx_admin_invitation_claim_token ON admin_invitation (claim_token)"
        )

def init_db():
    print("等待数据库连接...")
    max_retries = 30
    retry_interval = 2
    
    with app.app_context():
        # 打印脱敏后的数据库连接信息
        db_uri = app.config['SQLALCHEMY_DATABASE_URI']
        # 简单脱敏，避免打印密码
        try:
            part1, part2 = db_uri.split('://', 1)
            user_pass, host_db = part2.split('@', 1)
            print(f"尝试连接数据库: {part1}://****:****@{host_db}")
        except:
            print(f"尝试连接数据库: {db_uri}")

        for i in range(max_retries):
            try:
                # 尝试连接数据库
                db.engine.connect()
                print("数据库连接成功！")
                
                # 创建表
                print("正在创建数据库表...")
                db.create_all()
                ensure_schema_updates()
                print("数据库表创建完成！")
                return True
                
            except OperationalError as e:
                print(f"数据库未就绪 (尝试 {i+1}/{max_retries}): {e.orig if hasattr(e, 'orig') else e}")
                time.sleep(retry_interval)
            except Exception as e:
                print(f"发生未知错误: {e}")
                return False
                
    print("错误: 无法连接到数据库，请检查 Docker 日志。")
    return False

if __name__ == "__main__":
    if not init_db():
        sys.exit(1)

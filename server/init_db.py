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

    if 'teacher_invite' not in tables:
        print("检测到 teacher_invite 表不存在，将由 create_all 创建。")

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

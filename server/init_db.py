import time
import sys
from sqlalchemy.exc import OperationalError
from app import app, db

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

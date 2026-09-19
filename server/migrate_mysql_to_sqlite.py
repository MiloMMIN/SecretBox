"""一次性把旧 MySQL 数据迁移到 SQLite。

用法（在 server/ 目录下）:
    python migrate_mysql_to_sqlite.py mysql+pymysql://root:密码@主机:3306/treehole_db
    python migrate_mysql_to_sqlite.py mysql+pymysql://... sqlite:////app/data/treehole.db

默认目标为 ./data/treehole.db。目标库若已有同主键记录会被覆盖（可重复执行）。
"""

import os
import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# 先指向内存库，避免导入 app 时按默认配置连接
os.environ.setdefault('DATABASE_URL', 'sqlite://')

from app import (  # noqa: E402
    db,
    User,
    TeacherProfile,
    TeacherInvite,
    AdminApplication,
    AdminInvitation,
    Question,
    Reply,
    ReplyImage,
    Star,
    Appointment,
)

# 父表在前、子表在后，保持引用顺序
MODELS = [
    User,
    TeacherProfile,
    TeacherInvite,
    AdminApplication,
    AdminInvitation,
    Question,
    Reply,
    ReplyImage,
    Star,
    Appointment,
]


def migrate(source_url, target_url):
    src_engine = create_engine(source_url)
    dst_engine = create_engine(target_url)
    db.metadata.create_all(dst_engine)

    src = sessionmaker(bind=src_engine)()
    dst = sessionmaker(bind=dst_engine)()

    for model in MODELS:
        rows = src.query(model).all()
        for obj in rows:
            dst.merge(obj)
        dst.commit()
        print(f'{model.__tablename__}: {len(rows)} rows')

    print('迁移完成:', target_url)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    source = sys.argv[1]
    target = sys.argv[2] if len(sys.argv) > 2 else (
        'sqlite:///' + os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'treehole.db').replace(os.sep, '/')
    )
    migrate(source, target)

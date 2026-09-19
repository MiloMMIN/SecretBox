"""
学生管理员（student admin）功能测试。

使用内存 SQLite 验证：
1. 缺失的权限辅助函数已恢复（can_use_teacher_features / can_manage_teachers）；
2. 学生管理员可以查看并回复私密树洞（counselor_id=0）；
3. 学生管理员的回复被统计为“已被老师回复”；
4. 学生管理员管理接口（列表 / 授权 / 移除）及权限守卫；
5. 学生管理员可访问 /api/teacher/dashboard 等教师端点。
"""

import os
import sys
from unittest import mock

import pytest

SERVER_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server')
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

os.environ.setdefault('DATABASE_URL', 'sqlite://')
os.environ.setdefault('WX_APP_ID', '')
os.environ.setdefault('WX_APP_SECRET', '')

import app as app_module  # noqa: E402

flask_app = app_module.app
db = app_module.db


@pytest.fixture()
def client():
    with flask_app.app_context():
        flask_app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite://'
        db.drop_all()
        db.create_all()

        User = app_module.User
        Question = app_module.Question

        teacher = User(openid='teacher-openid', nickname='张老师', role='teacher', admin_level='none', wechat_id='teacher_wx')
        student = User(openid='student-openid', nickname='小明', role='student', admin_level='none', wechat_id='student_wx')
        st_admin = User(openid='stadmin-openid', nickname='小红', role='student', admin_level='admin', wechat_id='stadmin_wx')
        other_student = User(openid='other-openid', nickname='小刚', role='student', admin_level='none', wechat_id='other_wx')
        db.session.add_all([teacher, student, st_admin, other_student])
        db.session.flush()

        question = Question(
            content='最近压力好大，我该怎么调整？',
            user_id=student.id,
            counselor_id=0,
            is_anonymous=True,
            is_public=False,
            review_status='approved',
            audit_status='passed',
        )
        other_question = Question(
            content='小刚的私密心事',
            user_id=other_student.id,
            counselor_id=0,
            is_anonymous=True,
            is_public=False,
            review_status='approved',
            audit_status='passed',
        )
        db.session.add_all([question, other_question])
        db.session.commit()

        patcher_celery_q = mock.patch.object(app_module, 'audit_question', mock.MagicMock())
        patcher_celery_r = mock.patch.object(app_module, 'audit_reply', mock.MagicMock())
        patcher_celery_q.start()
        patcher_celery_r.start()

        with flask_app.test_client() as test_client:
            test_client.question_id = question.id
            test_client.other_question_id = other_question.id
            test_client.user_ids = {'teacher': teacher.id, 'student': student.id, 'student_admin': st_admin.id, 'other_student': other_student.id}
            yield test_client

        patcher_celery_q.stop()
        patcher_celery_r.stop()


def auth(openid):
    return {'Authorization': openid, 'Content-Type': 'application/json'}


def test_missing_permission_helpers_restored():
    assert callable(app_module.can_use_teacher_features)
    assert callable(app_module.can_manage_teachers)
    assert callable(app_module.is_student_admin)
    assert callable(app_module.is_official_replier)


def test_student_admin_can_view_and_reply_private_treehole(client):
    qid = client.question_id

    # 学生管理员：可以查看 + 回复
    res = client.get(f'/api/questions/{qid}', headers=auth('stadmin-openid'))
    assert res.status_code == 200, res.get_json()

    res = client.post(
        f'/api/questions/{qid}/replies',
        headers=auth('stadmin-openid'),
        json={'content': '同学，先深呼吸，再慢慢说。'},
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()['success'] is True


def test_plain_student_cannot_view_private_treehole_of_others(client):
    qid = client.other_question_id
    res = client.get(f'/api/questions/{qid}', headers=auth('student-openid'))
    assert res.status_code == 403, res.get_json()


def test_teacher_can_view_and_reply(client):
    qid = client.question_id
    res = client.get(f'/api/questions/{qid}', headers=auth('teacher-openid'))
    assert res.status_code == 200, res.get_json()

    res = client.post(f'/api/questions/{qid}/replies', headers=auth('teacher-openid'), json={'content': '老师回复'})
    assert res.status_code == 200, res.get_json()


def test_admin_reply_counts_as_official_reply(client):
    qid = client.question_id
    res = client.post(
        f'/api/questions/{qid}/replies',
        headers=auth('stadmin-openid'),
        json={'content': '管理员回复内容'},
    )
    assert res.status_code == 200

    Reply = app_module.Reply
    reply = Reply.query.filter_by(question_id=qid).first()
    reply.audit_status = 'passed'
    db.session.commit()

    summary = app_module.build_question_summary_map([qid])
    assert summary[qid]['hasTeacherReply'] is True

    # 学生能看到这条回复（审核通过）
    detail_res = client.get(f'/api/questions/{qid}', headers=auth('student-openid'))
    assert detail_res.status_code == 200, detail_res.get_json()
    replies = detail_res.get_json()['replies']
    assert any(r['content'] == '管理员回复内容' for r in replies)


def test_list_student_admins(client):
    st_admin_id = client.user_ids['student_admin']

    res = client.get('/api/admin/student-admins', headers=auth('teacher-openid'))
    assert res.status_code == 200, res.get_json()
    items = res.get_json()['items']
    assert [item['id'] for item in items] == [st_admin_id]


def test_create_student_admin_by_wechat_id(client):
    student_id = client.user_ids['student']
    res = client.post(
        '/api/admin/student-admins',
        headers=auth('teacher-openid'),
        json={'wechatId': 'student_wx', 'note': '负责高一树洞回复'},
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()['studentAdmin']['id'] == student_id

    user = app_module.User.query.get(student_id)
    assert user.admin_level == 'admin'


def test_create_student_admin_rejects_non_student(client):
    teacher_id = client.user_ids['teacher']
    res = client.post(
        '/api/admin/student-admins',
        headers=auth('teacher-openid'),
        json={'wechatId': 'teacher_wx'},
    )
    assert res.status_code == 400, res.get_json()


def test_create_student_admin_requires_admin_manager(client):
    res = client.post(
        '/api/admin/student-admins',
        headers=auth('student-openid'),
        json={'wechatId': 'student_wx'},
    )
    assert res.status_code == 403, res.get_json()


def test_remove_student_admin(client):
    student_id = client.user_ids['student']
    # 先授权
    res = client.post('/api/admin/student-admins', headers=auth('teacher-openid'), json={'wechatId': 'student_wx'})
    assert res.status_code == 200

    res = client.delete(f'/api/admin/student-admins/{student_id}', headers=auth('teacher-openid'))
    assert res.status_code == 200, res.get_json()

    with flask_app.app_context():
        user = app_module.User.query.get(student_id)
        assert user.admin_level == 'none'


def test_teacher_dashboard_accessible_to_student_admin(client):
    res = client.get('/api/teacher/dashboard', headers=auth('stadmin-openid'))
    assert res.status_code == 200, res.get_json()
    assert 'inboxCount' in res.get_json()


def test_teacher_questions_inbox_accessible_to_student_admin(client):
    res = client.get('/api/teacher/questions?scope=inbox', headers=auth('stadmin-openid'))
    assert res.status_code == 200, res.get_json()
    items = res.get_json()['items']
    assert any(item['id'] == client.question_id for item in items)


def test_serialize_user_exposes_new_flags(client):
    res = client.get('/api/me', headers=auth('stadmin-openid'))
    assert res.status_code == 200, res.get_json()
    data = res.get_json()
    assert data['canUseTeacherFeatures'] is True
    assert data['isStudentAdmin'] is True
    assert data['role'] == 'student'
    assert data['adminLevel'] == 'admin'

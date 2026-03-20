from flask import Flask, jsonify, request, Response, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from celery import Celery
import os
import requests
import urllib.parse
import csv
import io
import uuid
from datetime import datetime, timedelta
from sqlalchemy import UniqueConstraint, func, or_
from sqlalchemy.orm import joinedload, selectinload
from werkzeug.utils import secure_filename
from urllib.parse import urlparse

class Config:
    # 数据库配置
    # 优先使用独立环境变量构建连接字符串，以支持特殊字符（如密码中的 @）
    db_password = os.getenv('MYSQL_ROOT_PASSWORD')
    if db_password:
        db_user = 'root' # Docker Compose 默认为 root
        db_host = os.getenv('MYSQL_HOST', 'db')
        db_port = os.getenv('MYSQL_PORT', '3306')
        db_name = os.getenv('MYSQL_DATABASE', 'treehole_db')
        encoded_password = urllib.parse.quote_plus(db_password)
        SQLALCHEMY_DATABASE_URI = f"mysql+pymysql://{db_user}:{encoded_password}@{db_host}:{db_port}/{db_name}"
    else:
        # 兼容旧逻辑
        SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', 'mysql+pymysql://root:password@db/treehole_db')
    
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        'pool_recycle': 1800,
    }

    # Redis 配置
    # 优先读取环境变量 REDIS_URL，否则使用默认值
    CELERY_BROKER_URL = os.getenv('REDIS_URL', 'redis://redis:6379/0')
    CELERY_RESULT_BACKEND = os.getenv('REDIS_URL', 'redis://redis:6379/0')

    # 微信小程序配置
    WX_APP_ID = os.getenv('WX_APP_ID')
    WX_APP_SECRET = os.getenv('WX_APP_SECRET')

    # Flask 配置
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key')
    UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
    MAX_CONTENT_LENGTH = 10 * 1024 * 1024

    # 角色配置
    TEACHER_OPENIDS = [
        openid.strip() for openid in os.getenv('TEACHER_OPENIDS', '').split(',') if openid.strip()
    ]
    TEACHER_INVITE_CODE = os.getenv('TEACHER_INVITE_CODE', '').strip()

app = Flask(__name__)

# 配置
app.config.from_object(Config)
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# 微信小程序配置
WX_APP_ID = app.config.get('WX_APP_ID')
WX_APP_SECRET = app.config.get('WX_APP_SECRET')
TEACHER_OPENIDS = set(app.config.get('TEACHER_OPENIDS', []))
TEACHER_INVITE_CODE = app.config.get('TEACHER_INVITE_CODE', '')
WECHAT_ACCESS_TOKEN_CACHE = {
    'token': None,
    'expires_at': None
}
DEFAULT_QUESTION_PAGE_SIZE = 20
MAX_QUESTION_PAGE_SIZE = 50


def parse_positive_int(value, default):
    try:
        parsed = int(value)
        return parsed if parsed > 0 else default
    except (TypeError, ValueError):
        return default


def is_placeholder_wechat_value(value):
    if not value:
        return True

    normalized = value.strip().lower()
    placeholder_values = {
        'your_app_id',
        'your_app_id_here',
        'your_app_secret',
        'your_app_secret_here',
    }
    return normalized in placeholder_values or normalized.startswith('your_')


def is_wechat_configured():
    return not is_placeholder_wechat_value(WX_APP_ID) and not is_placeholder_wechat_value(WX_APP_SECRET)


def get_wechat_access_token():
    cached_token = WECHAT_ACCESS_TOKEN_CACHE.get('token')
    expires_at = WECHAT_ACCESS_TOKEN_CACHE.get('expires_at')
    if cached_token and expires_at and datetime.utcnow() < expires_at:
        return cached_token

    url = (
        'https://api.weixin.qq.com/cgi-bin/token'
        f'?grant_type=client_credential&appid={WX_APP_ID}&secret={WX_APP_SECRET}'
    )
    response = requests.get(url, timeout=5)
    data = response.json()
    if data.get('errcode'):
        raise ValueError(data.get('errmsg') or '获取微信 access_token 失败')

    access_token = data.get('access_token')
    expires_in = int(data.get('expires_in') or 7200)
    if not access_token:
        raise ValueError('微信 access_token 缺失')

    WECHAT_ACCESS_TOKEN_CACHE['token'] = access_token
    WECHAT_ACCESS_TOKEN_CACHE['expires_at'] = datetime.utcnow() + timedelta(seconds=max(expires_in - 300, 60))
    return access_token


def run_wechat_text_security_check(content, openid=''):
    access_token = get_wechat_access_token()
    url = f'https://api.weixin.qq.com/wxa/msg_sec_check?access_token={access_token}'
    payload = {
        'content': content,
        'version': 2,
        'scene': 2
    }
    if openid:
        payload['openid'] = openid

    response = requests.post(url, json=payload, timeout=5)
    data = response.json()

    if data.get('errcode') == 0:
        result = data.get('result') or {}
        suggest = result.get('suggest', 'pass')
        if suggest in {'risky', 'review'}:
            return {
                'ok': False,
                'message': '内容包含敏感信息，请修改后重试',
                'reason': suggest,
                'raw': data
            }

        return {
            'ok': True,
            'reason': 'pass',
            'raw': data
        }

    if data.get('errcode') == 87014:
        return {
            'ok': False,
            'message': '内容包含敏感信息，请修改后重试',
            'reason': 'risky',
            'raw': data
        }

    raise ValueError(data.get('errmsg') or '微信内容安全校验失败')


def audit_text_content(content, openid=''):
    if not content:
        return {'ok': True}

    if not is_wechat_configured():
        return {'ok': True, 'skipped': True, 'reason': 'wechat_not_configured'}

    try:
        return run_wechat_text_security_check(content, openid)
    except Exception as exc:
        print(f'Warning: WeChat content security check skipped due to error: {exc}')
        return {'ok': True, 'skipped': True, 'reason': 'wechat_check_failed'}

db = SQLAlchemy(app)

# 初始化 Celery
celery = Celery(app.name, broker=app.config['CELERY_BROKER_URL'])
celery.conf.update(app.config)


def resolve_user_role(openid, current_role=None):
    if current_role == 'teacher':
        return 'teacher'
    return 'teacher' if openid in TEACHER_OPENIDS else 'student'


def serialize_user(user):
    return {
        'id': user.id,
        'nickName': user.nickname,
        'nickname': user.nickname,
        'avatarUrl': user.avatar_url,
        'role': user.role
    }


def get_or_create_teacher_profile(user):
    profile = TeacherProfile.query.filter_by(user_id=user.id).first()
    if not profile:
        profile = TeacherProfile(
            user_id=user.id,
            display_name=user.nickname,
            avatar_url=user.avatar_url,
            description='已认证教师'
        )
        db.session.add(profile)
        db.session.flush()
    return profile


def serialize_teacher_profile(user, profile=None):
    profile = profile or TeacherProfile.query.filter_by(user_id=user.id).first()
    display_name = (profile.display_name if profile and profile.display_name else user.nickname) or '未命名教师'
    avatar_url = (profile.avatar_url if profile and profile.avatar_url else user.avatar_url) or ''
    description = (profile.description if profile and profile.description else '已认证教师')
    is_active = True if profile is None else profile.is_active
    return {
        'kind': 'teacher',
        'id': user.id,
        'nickName': display_name,
        'avatarUrl': avatar_url,
        'desc': description,
        'isActive': is_active
    }


def serialize_teacher_invite(invite):
    return {
        'kind': 'invite',
        'id': invite.id,
        'nickName': invite.display_name or '待激活教师',
        'avatarUrl': invite.avatar_url or '',
        'desc': invite.description or '待教师本人激活',
        'isActive': invite.is_active,
        'inviteCode': invite.invite_code,
        'claimed': invite.claimed_user_id is not None
    }


def build_file_url(filename):
    return f"{request.host_url.rstrip('/')}/uploads/{filename}"


def sanitize_avatar_url(file_url):
    if not file_url:
        return ''

    normalized = file_url.strip()
    lowered = normalized.lower()
    if lowered.startswith('wxfile://') or lowered.startswith('http://tmp/') or lowered.startswith('https://tmp/'):
        return ''

    parsed = urlparse(normalized)
    if parsed.scheme in {'http', 'https'}:
        return normalized[:256]

    return ''


def remove_uploaded_file_by_url(file_url):
    if not file_url:
        return

    parsed = urlparse(file_url)
    if '/uploads/' not in parsed.path:
        return

    filename = parsed.path.rsplit('/uploads/', 1)[-1]
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass


def get_authenticated_user():
    token = request.headers.get('Authorization')
    if not token:
        return None
    return User.query.filter_by(openid=token).first()


def get_question_author_payload(question):
    if question.is_anonymous:
        return {
            'nickName': '匿名用户',
            'avatarUrl': '',
            'role': 'student'
        }

    return {
        'nickName': question.user.nickname or '微信用户',
        'avatarUrl': question.user.avatar_url,
        'role': question.user.role
    }


def build_reply_preview(reply):
    if not reply:
        return None

    if reply.content:
        return reply.content

    if reply.images:
        return '[图片回复]'

    return None


def get_teacher_replied_question_ids(question_ids):
    if not question_ids:
        return set()

    rows = get_teacher_replied_question_id_query().filter(
        Reply.question_id.in_(question_ids)
    ).all()
    return {question_id for (question_id,) in rows}


def get_teacher_replied_question_id_query():
    return db.session.query(Reply.question_id).join(
        User, Reply.user_id == User.id
    ).filter(
        User.role == 'teacher'
    ).distinct()


def build_question_summary_map(question_ids, current_user_id=None):
    summary_map = {
        question_id: {
            'comments': 0,
            'latestReplyPreview': None,
            'teacherReply': None,
            'hasTeacherReply': False,
            'starred': False
        }
        for question_id in question_ids
    }
    if not question_ids:
        return summary_map

    reply_count_rows = db.session.query(
        Reply.question_id,
        func.count(Reply.id)
    ).filter(
        Reply.question_id.in_(question_ids)
    ).group_by(
        Reply.question_id
    ).all()
    for question_id, reply_count in reply_count_rows:
        summary_map[question_id]['comments'] = reply_count

    replies = Reply.query.options(
        joinedload(Reply.user),
        selectinload(Reply.images)
    ).filter(
        Reply.question_id.in_(question_ids)
    ).order_by(
        Reply.question_id.asc(),
        Reply.created_at.desc()
    ).all()

    latest_seen = set()
    latest_teacher_seen = set()
    for reply in replies:
        summary = summary_map.get(reply.question_id)
        if not summary:
            continue

        if reply.question_id not in latest_seen:
            summary['latestReplyPreview'] = build_reply_preview(reply)
            latest_seen.add(reply.question_id)

        if reply.user and reply.user.role == 'teacher' and reply.question_id not in latest_teacher_seen:
            summary['teacherReply'] = reply.content
            summary['hasTeacherReply'] = True
            latest_teacher_seen.add(reply.question_id)

    if current_user_id:
        starred_rows = db.session.query(Star.question_id).filter(
            Star.user_id == current_user_id,
            Star.question_id.in_(question_ids)
        ).all()
        starred_question_ids = {question_id for (question_id,) in starred_rows}
        for question_id in starred_question_ids:
            summary_map[question_id]['starred'] = True

    return summary_map


def serialize_reply(reply):
    return {
        'id': reply.id,
        'content': reply.content,
        'time': reply.created_at.strftime('%Y-%m-%d %H:%M'),
        'images': [image.image_url for image in reply.images],
        'user': {
            'nickname': reply.user.nickname,
            'avatarUrl': reply.user.avatar_url,
            'role': reply.user.role
        }
    }


def get_latest_teacher_reply(question_id):
    return Reply.query.join(User, Reply.user_id == User.id).filter(
        Reply.question_id == question_id,
        User.role == 'teacher'
    ).order_by(Reply.created_at.desc()).first()


def get_latest_reply(question_id):
    return Reply.query.filter_by(question_id=question_id).order_by(Reply.created_at.desc()).first()


def can_view_question(user, question):
    if question.audit_status != 'passed':
        return bool(user and question.user_id == user.id)

    if question.is_public and question.review_status == 'approved':
        return True

    if not user:
        return False

    if question.user_id == user.id:
        return True

    if user.role != 'teacher':
        return False

    if question.is_public:
        return True

    return question.counselor_id == user.id or question.counselor_id == 0


def get_question_review_label(review_status):
    labels = {
        'pending': '审核中',
        'approved': '已通过',
        'rejected': '未通过'
    }
    return labels.get(review_status, '审核中')


def serialize_question_review(question):
    return {
        'reviewStatus': question.review_status,
        'reviewStatusText': get_question_review_label(question.review_status),
        'auditStatus': question.audit_status,
        'reviewReason': question.review_reason
    }


def needs_teacher_review(question):
    return question.is_public and question.review_status == 'pending'


def is_teacher_reply_actionable(question, teacher_replied_question_ids=None):
    if teacher_replied_question_ids is None:
        has_teacher_reply = get_latest_teacher_reply(question.id) is not None
    else:
        has_teacher_reply = question.id in teacher_replied_question_ids

    return not needs_teacher_review(question) and not has_teacher_reply


def build_teacher_visible_question_query(user, eager=False):
    query = Question.query
    if eager:
        query = query.options(joinedload(Question.user))

    return query.filter(
        Question.audit_status == 'passed',
        or_(
            Question.is_public.is_(True),
            Question.counselor_id == user.id,
            Question.counselor_id == 0
        )
    )


def apply_teacher_question_scope(query, user, scope, review_status='all', today_start=None):
    today_start = today_start or datetime.combine(datetime.now().date(), datetime.min.time())
    teacher_replied_query = get_teacher_replied_question_id_query()

    if scope == 'pending':
        query = query.filter(
            or_(
                Question.is_public.is_(False),
                Question.review_status == 'approved'
            )
        ).filter(
            ~Question.id.in_(teacher_replied_query)
        )
    elif scope == 'today':
        query = query.filter(
            Question.created_at >= today_start
        ).filter(
            or_(
                Question.is_public.is_(False),
                Question.review_status == 'approved'
            )
        )
    elif scope == 'inbox':
        query = query.filter(
            Question.counselor_id == user.id,
            Question.is_public.is_(False)
        )
    elif scope == 'square':
        query = query.filter(Question.is_public.is_(True))

    if scope == 'square' and review_status in {'pending', 'approved', 'rejected'}:
        query = query.filter(Question.review_status == review_status)

    return query


def ensure_teacher_user():
    user = get_authenticated_user()
    if not user:
        return None, (jsonify({'error': 'Unauthorized'}), 401)
    if user.role != 'teacher':
        return None, (jsonify({'error': 'Forbidden'}), 403)
    return user, None


def get_teacher_visible_questions(user):
    return build_teacher_visible_question_query(user, eager=True).order_by(Question.created_at.desc()).all()


def serialize_teacher_question(question, summary=None):
    student = None
    if not question.is_anonymous and (question.student_name or question.student_class):
        student = {
            'name': question.student_name,
            'className': question.student_class
        }

    summary = summary or build_question_summary_map([question.id]).get(question.id, {})

    return {
        'id': question.id,
        'content': question.content,
        'time': question.created_at.strftime('%Y-%m-%d %H:%M'),
        'isPublic': question.is_public,
        'isAnonymous': question.is_anonymous,
        'reviewStatus': question.review_status,
        'reviewStatusText': get_question_review_label(question.review_status),
        'reviewReason': question.review_reason,
        'stars': question.stars,
        'comments': summary.get('comments', 0),
        'hasTeacherReply': summary.get('hasTeacherReply', False),
        'latestReplyPreview': summary.get('latestReplyPreview'),
        'student': student,
        'author': get_question_author_payload(question)
    }

# --- Models ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    openid = db.Column(db.String(64), unique=True, nullable=False)
    nickname = db.Column(db.String(64))
    avatar_url = db.Column(db.String(256))
    role = db.Column(db.String(20), default='student') # student, teacher
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Question(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    counselor_id = db.Column(db.Integer) # 0 for Starry Hole
    is_anonymous = db.Column(db.Boolean, default=False)
    is_public = db.Column(db.Boolean, default=False)
    review_status = db.Column(db.String(20), default='approved', nullable=False)
    review_reason = db.Column(db.String(255))
    audit_status = db.Column(db.String(20), default='passed', nullable=False)
    audit_checked_at = db.Column(db.DateTime)
    student_class = db.Column(db.String(64))
    student_name = db.Column(db.String(64))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 统计数据
    stars = db.Column(db.Integer, default=0)
    
    user = db.relationship('User', backref=db.backref('questions', lazy=True))

class Reply(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    question_id = db.Column(db.Integer, db.ForeignKey('question.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    user = db.relationship('User', backref=db.backref('replies', lazy=True))
    question = db.relationship('Question', backref=db.backref('replies_list', lazy=True))


class ReplyImage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    reply_id = db.Column(db.Integer, db.ForeignKey('reply.id'), nullable=False)
    image_url = db.Column(db.String(512), nullable=False)

    reply = db.relationship('Reply', backref=db.backref('images', lazy=True, cascade='all, delete-orphan'))


class Star(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    question_id = db.Column(db.Integer, db.ForeignKey('question.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('user_id', 'question_id', name='uq_star_user_question'),
    )


class TeacherProfile(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, unique=True)
    display_name = db.Column(db.String(64))
    avatar_url = db.Column(db.String(512))
    description = db.Column(db.String(255), default='已认证教师')
    is_active = db.Column(db.Boolean, default=True)
    last_checked_at = db.Column(db.DateTime)

    user = db.relationship('User', backref=db.backref('teacher_profile', uselist=False, lazy=True))


class TeacherInvite(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    invite_code = db.Column(db.String(32), unique=True, nullable=False)
    display_name = db.Column(db.String(64))
    avatar_url = db.Column(db.String(512))
    description = db.Column(db.String(255), default='待教师本人激活')
    is_active = db.Column(db.Boolean, default=True)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    claimed_user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# 自动建表 (移至 init_db.py 中统一处理，避免 import 时触发连接错误)
# with app.app_context():
#    db.create_all()


@celery.task(bind=True, name='tasks.audit_public_question')
def audit_public_question(self, question_id):
    with app.app_context():
        question = Question.query.options(joinedload(Question.user)).filter_by(id=question_id).first()
        if not question or not question.is_public:
            return {'status': 'skipped'}

        if question.audit_status == 'passed':
            return {'status': 'passed'}

        if not question.content or not is_wechat_configured():
            question.audit_status = 'passed'
            question.audit_checked_at = datetime.utcnow()
            db.session.commit()
            return {'status': 'passed'}

        try:
            audit_result = run_wechat_text_security_check(question.content, question.user.openid if question.user else '')
        except Exception as exc:
            if self.request.retries >= 3:
                question.audit_status = 'failed'
                question.audit_checked_at = datetime.utcnow()
                question.review_reason = '系统审核暂时异常，请稍后查看结果'
                db.session.commit()
                raise

            raise self.retry(exc=exc, countdown=min(30 * (self.request.retries + 1), 180))

        question.audit_checked_at = datetime.utcnow()
        if audit_result.get('ok'):
            question.audit_status = 'passed'
            question.review_reason = None
        else:
            question.audit_status = 'rejected'
            question.review_status = 'rejected'
            question.review_reason = '未通过系统内容审核'

        db.session.commit()
        return {'status': question.audit_status}


# --- API ---

@app.route('/')
def hello():
    return "Wisdom Heart Tree Hole API V1.0 Running"


@app.route('/uploads/<path:filename>', methods=['GET'])
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/api/uploads/image', methods=['POST'])
def upload_image():
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    image_file = request.files.get('file')
    if not image_file or not image_file.filename:
        return jsonify({'error': 'Missing file'}), 400

    ext = os.path.splitext(secure_filename(image_file.filename))[1].lower()
    if ext not in {'.jpg', '.jpeg', '.png', '.gif', '.webp'}:
        return jsonify({'error': 'Unsupported file type'}), 400

    purpose = (request.args.get('purpose') or '').strip().lower()
    if purpose == 'avatar':
        image_file.stream.seek(0, os.SEEK_END)
        file_size = image_file.stream.tell()
        image_file.stream.seek(0)
        if file_size > 512 * 1024:
            return jsonify({'error': '头像图片请压缩到 512KB 以内'}), 400

    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    image_file.save(file_path)

    return jsonify({'success': True, 'url': build_file_url(filename)})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    code = data.get('code')
    userInfo = data.get('userInfo', {})
    
    if not code:
        return jsonify({'error': 'Missing code'}), 400
        
    # 换取 OpenID
    url = f"https://api.weixin.qq.com/sns/jscode2session?appid={WX_APP_ID}&secret={WX_APP_SECRET}&js_code={code}&grant_type=authorization_code"
    
    # 开发环境/占位配置时使用 Mock 登录
    if is_placeholder_wechat_value(WX_APP_ID) or is_placeholder_wechat_value(WX_APP_SECRET):
        print("Warning: Using Mock Login (WeChat credentials are not configured)")
        openid = f"mock_openid_{code}" # 模拟 OpenID
    else:
        try:
            res = requests.get(url, timeout=5)
            res_data = res.json()
            if 'errcode' in res_data and res_data['errcode'] != 0:
                return jsonify({'error': res_data.get('errmsg')}), 400
            openid = res_data['openid']
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    # 查找或创建用户
    user = User.query.filter_by(openid=openid).first()
    if not user:
        user = User(openid=openid, role=resolve_user_role(openid))
        db.session.add(user)
    else:
        user.role = resolve_user_role(openid, user.role)
    
    # 更新用户信息
    if userInfo:
        user.nickname = userInfo.get('nickName')
        avatar_url = sanitize_avatar_url(userInfo.get('avatarUrl'))
        if avatar_url:
            user.avatar_url = avatar_url

    db.session.flush()
    if user.role == 'teacher':
        profile = get_or_create_teacher_profile(user)
        if user.nickname and not profile.display_name:
            profile.display_name = user.nickname
        if user.avatar_url and not profile.avatar_url:
            profile.avatar_url = user.avatar_url
    
    db.session.commit()
    
    return jsonify({
        'token': openid, # 简单起见，直接用 openid 做 token，生产环境应使用 JWT
        'userInfo': serialize_user(user)
    })


@app.route('/api/me', methods=['GET'])
def get_me():
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    return jsonify(serialize_user(user))


@app.route('/api/me/profile', methods=['PUT'])
def update_me_profile():
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json or {}
    nickname = (data.get('nickName') or data.get('nickname') or '').strip()
    avatar_url = sanitize_avatar_url(data.get('avatarUrl'))
    old_avatar_url = user.avatar_url

    if nickname:
        user.nickname = nickname[:64]
    if avatar_url:
        user.avatar_url = avatar_url[:256]
        if old_avatar_url and old_avatar_url != user.avatar_url:
            remove_uploaded_file_by_url(old_avatar_url)

    if user.role == 'teacher':
        profile = get_or_create_teacher_profile(user)
        if nickname:
            profile.display_name = user.nickname
        if avatar_url:
            profile.avatar_url = user.avatar_url

    db.session.commit()
    return jsonify({'success': True, 'userInfo': serialize_user(user)})


@app.route('/api/me/role', methods=['POST'])
def upgrade_me_role():
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    invite_code = ((request.json or {}).get('inviteCode') or '').strip()
    teacher_invite = TeacherInvite.query.filter_by(invite_code=invite_code, is_active=True, claimed_user_id=None).first()
    if teacher_invite:
        user.role = 'teacher'
        profile = get_or_create_teacher_profile(user)
        profile.display_name = (teacher_invite.display_name or user.nickname or '未命名教师')[:64]
        profile.avatar_url = teacher_invite.avatar_url or user.avatar_url
        profile.description = (teacher_invite.description or '已认证教师')[:255]
        profile.is_active = teacher_invite.is_active
        teacher_invite.claimed_user_id = user.id
        db.session.commit()
        return jsonify({'success': True, 'userInfo': serialize_user(user)})

    if not TEACHER_INVITE_CODE:
        return jsonify({'error': '教师邀请码未配置'}), 400

    if invite_code != TEACHER_INVITE_CODE:
        return jsonify({'error': '邀请码错误'}), 400

    user.role = 'teacher'
    profile = get_or_create_teacher_profile(user)
    if user.nickname and not profile.display_name:
        profile.display_name = user.nickname
    if user.avatar_url and not profile.avatar_url:
        profile.avatar_url = user.avatar_url
    db.session.commit()
    return jsonify({'success': True, 'userInfo': serialize_user(user)})


@app.route('/api/teachers', methods=['GET'])
def get_teachers():
    teachers = User.query.filter_by(role='teacher').order_by(User.created_at.asc()).all()
    result = []
    for teacher in teachers:
        profile = get_or_create_teacher_profile(teacher)
        if profile.is_active:
            result.append(serialize_teacher_profile(teacher, profile))
    db.session.commit()
    return jsonify(result)


@app.route('/api/teacher/profiles', methods=['GET'])
def get_teacher_profiles():
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    teachers = User.query.filter_by(role='teacher').order_by(User.created_at.asc()).all()
    profiles = []
    for teacher in teachers:
        profile = get_or_create_teacher_profile(teacher)
        profiles.append(serialize_teacher_profile(teacher, profile))
    invites = TeacherInvite.query.order_by(TeacherInvite.created_at.desc()).all()
    db.session.commit()
    return jsonify(profiles + [serialize_teacher_invite(invite) for invite in invites])


@app.route('/api/teacher/invites', methods=['POST'])
def create_teacher_invite():
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    data = request.json or {}
    display_name = (data.get('nickName') or '').strip() or '待激活教师'
    avatar_url = (data.get('avatarUrl') or '').strip()
    description = (data.get('desc') or '').strip() or '待教师本人激活'
    is_active = bool(data.get('isActive', True))
    invite_code = uuid.uuid4().hex[:8].upper()

    invite = TeacherInvite(
        invite_code=invite_code,
        display_name=display_name[:64],
        avatar_url=avatar_url[:512],
        description=description[:255],
        is_active=is_active,
        created_by_user_id=user.id
    )
    db.session.add(invite)
    db.session.commit()
    return jsonify({'success': True, 'profile': serialize_teacher_invite(invite)})


@app.route('/api/teacher/invites/<int:invite_id>', methods=['PUT'])
def update_teacher_invite(invite_id):
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    invite = TeacherInvite.query.get_or_404(invite_id)
    data = request.json or {}
    display_name = (data.get('nickName') or '').strip()
    avatar_url = (data.get('avatarUrl') or '').strip()
    description = (data.get('desc') or '').strip()
    is_active = data.get('isActive')

    if display_name:
        invite.display_name = display_name[:64]
    if avatar_url:
        invite.avatar_url = avatar_url[:512]
    if description:
        invite.description = description[:255]
    if isinstance(is_active, bool):
        invite.is_active = is_active

    db.session.commit()
    return jsonify({'success': True, 'profile': serialize_teacher_invite(invite)})


@app.route('/api/teacher/profiles/<int:teacher_id>', methods=['PUT'])
def update_teacher_profile(teacher_id):
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    teacher = User.query.get_or_404(teacher_id)
    if teacher.role != 'teacher':
        return jsonify({'error': 'Target is not teacher'}), 400

    data = request.json or {}
    profile = get_or_create_teacher_profile(teacher)
    display_name = (data.get('nickName') or '').strip()
    avatar_url = (data.get('avatarUrl') or '').strip()
    description = (data.get('desc') or '').strip()
    is_active = data.get('isActive')

    if display_name:
        profile.display_name = display_name[:64]
    if avatar_url:
        profile.avatar_url = avatar_url[:512]
    if description:
        profile.description = description[:255]
    if isinstance(is_active, bool):
        profile.is_active = is_active

    if teacher.id == user.id:
        teacher.nickname = profile.display_name or teacher.nickname
        teacher.avatar_url = profile.avatar_url or teacher.avatar_url

    db.session.commit()
    return jsonify({'success': True, 'profile': serialize_teacher_profile(teacher, profile)})


@app.route('/api/teacher/dashboard', methods=['GET'])
def get_teacher_dashboard():
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    profile = get_or_create_teacher_profile(user)
    today_start = datetime.combine(datetime.now().date(), datetime.min.time())
    base_query = build_teacher_visible_question_query(user)
    unread_query = base_query
    if profile.last_checked_at:
        unread_query = unread_query.filter(Question.created_at > profile.last_checked_at)

    return jsonify({
        'pendingCount': apply_teacher_question_scope(base_query, user, 'pending', today_start=today_start).count(),
        'reviewPendingCount': apply_teacher_question_scope(base_query, user, 'square', review_status='pending', today_start=today_start).count(),
        'todayCount': apply_teacher_question_scope(base_query, user, 'today', today_start=today_start).count(),
        'inboxCount': apply_teacher_question_scope(base_query, user, 'inbox', today_start=today_start).count(),
        'squareCount': apply_teacher_question_scope(base_query, user, 'square', today_start=today_start).count(),
        'unreadCount': unread_query.count()
    })


@app.route('/api/teacher/notifications/read', methods=['POST'])
def mark_teacher_notifications_read():
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    profile = get_or_create_teacher_profile(user)
    profile.last_checked_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/teacher/questions', methods=['GET'])
def get_teacher_questions():
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    scope = request.args.get('scope', 'pending')
    review_status = request.args.get('reviewStatus', 'all')
    page = parse_positive_int(request.args.get('page'), 1)
    page_size = min(
        parse_positive_int(request.args.get('pageSize'), DEFAULT_QUESTION_PAGE_SIZE),
        MAX_QUESTION_PAGE_SIZE
    )
    today_start = datetime.combine(datetime.now().date(), datetime.min.time())
    query = apply_teacher_question_scope(
        build_teacher_visible_question_query(user, eager=True),
        user,
        scope,
        review_status=review_status,
        today_start=today_start
    ).order_by(Question.created_at.desc(), Question.id.desc())

    offset = (page - 1) * page_size
    paged_questions = query.offset(offset).limit(page_size + 1).all()
    has_more = len(paged_questions) > page_size
    questions = paged_questions[:page_size]
    summary_map = build_question_summary_map([question.id for question in questions])
    return jsonify({
        'items': [
            serialize_teacher_question(question, summary_map.get(question.id))
            for question in questions
        ],
        'pagination': {
            'page': page,
            'pageSize': page_size,
            'hasMore': has_more
        }
    })


@app.route('/api/teacher/export', methods=['GET'])
def export_teacher_questions():
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    scope = request.args.get('scope', 'all')
    review_status = request.args.get('reviewStatus', 'all')
    today_start = datetime.combine(datetime.now().date(), datetime.min.time())
    questions = apply_teacher_question_scope(
        build_teacher_visible_question_query(user, eager=True),
        user,
        scope,
        review_status=review_status,
        today_start=today_start
    ).order_by(Question.created_at.desc(), Question.id.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output, delimiter='\t')
    writer.writerow(['ID', '类型', '提问时间', '内容', '学生班级', '学生姓名', '是否已被教师回复', '最新评论'])
    summary_map = build_question_summary_map([question.id for question in questions])

    for question in questions:
        summary = summary_map.get(question.id, {})
        writer.writerow([
            question.id,
            '广场' if question.is_public else '私密',
            question.created_at.strftime('%Y-%m-%d %H:%M'),
            question.content,
            question.student_class or '',
            question.student_name or '',
            '是' if summary.get('hasTeacherReply') else '否',
            summary.get('latestReplyPreview') or ''
        ])

    filename = f"secretbox-export-{scope}-{datetime.now().strftime('%Y%m%d%H%M%S')}.xls"
    csv_content = '\ufeff' + output.getvalue()
    return Response(
        csv_content,
        mimetype='application/vnd.ms-excel; charset=utf-8',
        headers={'Content-Disposition': f'attachment; filename={filename}'}
    )

# 获取问题广场列表
@app.route('/api/questions', methods=['GET'])
def get_questions():
    search = request.args.get('search', '')
    sort = request.args.get('sort', 'time')
    page = parse_positive_int(request.args.get('page'), 1)
    page_size = min(
        parse_positive_int(request.args.get('pageSize'), DEFAULT_QUESTION_PAGE_SIZE),
        MAX_QUESTION_PAGE_SIZE
    )
    user = get_authenticated_user()
    
    query = Question.query.options(
        joinedload(Question.user)
    ).filter_by(
        is_public=True,
        review_status='approved',
        audit_status='passed'
    )
    
    if search:
        query = query.filter(Question.content.contains(search))
        
    if sort == 'hot':
        query = query.order_by(
            Question.stars.desc(),
            Question.created_at.desc(),
            Question.id.desc()
        )
    elif sort == 'discuss':
        # 简单实现，暂不支持按评论数排序，仍按时间
        query = query.order_by(
            Question.created_at.desc(),
            Question.id.desc()
        )
    else:
        query = query.order_by(
            Question.created_at.desc(),
            Question.id.desc()
        )

    offset = (page - 1) * page_size
    paged_questions = query.offset(offset).limit(page_size + 1).all()
    has_more = len(paged_questions) > page_size
    questions = paged_questions[:page_size]
    summary_map = build_question_summary_map(
        [question.id for question in questions],
        user.id if user else None
    )
    
    result = []
    for q in questions:
        summary = summary_map.get(q.id, {})
        result.append({
            'id': q.id,
            'content': q.content,
            'time': q.created_at.strftime('%Y-%m-%d %H:%M'),
            'stars': q.stars,
            'comments': summary.get('comments', 0),
            'reply': summary.get('teacherReply'),
            'latestReplyPreview': summary.get('latestReplyPreview'),
            'hasTeacherReply': summary.get('hasTeacherReply', False),
            'isPublic': q.is_public,
            'user': get_question_author_payload(q),
            'starred': summary.get('starred', False),
            **serialize_question_review(q)
        })

    return jsonify({
        'items': result,
        'pagination': {
            'page': page,
            'pageSize': page_size,
            'hasMore': has_more
        }
    })

# 获取问题详情及回复
@app.route('/api/questions/<int:qid>', methods=['GET'])
def get_question_detail(qid):
    q = Question.query.options(joinedload(Question.user)).filter_by(id=qid).first_or_404()
    user = get_authenticated_user()
    if not can_view_question(user, q):
        return jsonify({'error': 'Forbidden'}), 403

    replies = Reply.query.options(
        joinedload(Reply.user),
        selectinload(Reply.images)
    ).filter_by(
        question_id=qid
    ).order_by(
        Reply.created_at.asc()
    ).all()
    starred = False
    if user:
        starred = Star.query.filter_by(user_id=user.id, question_id=q.id).first() is not None
    summary = build_question_summary_map([q.id]).get(q.id, {})

    return jsonify({
        'id': q.id,
        'content': q.content,
        'time': q.created_at.strftime('%Y-%m-%d %H:%M'),
        'stars': q.stars,
        'starred': starred,
        'isPublic': q.is_public,
        'user': get_question_author_payload(q),
        'latestReplyPreview': summary.get('latestReplyPreview'),
        **serialize_question_review(q),
        'replies': [serialize_reply(reply) for reply in replies]
    })

# 发布问题
@app.route('/api/questions', methods=['POST'])
def create_question():
    data = request.json or {}
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({'error': 'Missing content'}), 400

    is_public = bool(data.get('isPublic', False))
    audit_status = 'passed'
    audit_checked_at = datetime.utcnow()
    if is_public:
        if is_wechat_configured():
            audit_status = 'pending'
            audit_checked_at = None
    else:
        audit_result = audit_text_content(content, user.openid)
        if not audit_result.get('ok'):
            return jsonify({'error': audit_result.get('message') or '内容审核未通过'}), 400
        
    q = Question(
        content=content,
        user_id=user.id,
        counselor_id=data.get('counselorId'),
        is_anonymous=data.get('isAnonymous', False),
        is_public=is_public,
        review_status='pending' if is_public else 'approved',
        review_reason=None,
        audit_status=audit_status,
        audit_checked_at=audit_checked_at,
        student_class=data.get('studentClass'),
        student_name=data.get('studentName')
    )
    db.session.add(q)
    db.session.commit()

    if is_public and q.audit_status == 'pending':
        try:
            audit_public_question.delay(q.id)
        except Exception:
            db.session.delete(q)
            db.session.commit()
            return jsonify({'error': '内容审核排队失败，请稍后重试'}), 503
    
    return jsonify({'success': True, 'id': q.id, **serialize_question_review(q)})

# 回复问题
@app.route('/api/questions/<int:qid>/replies', methods=['POST'])
def create_reply(qid):
    data = request.json or {}
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    q = Question.query.get_or_404(qid)
    if not can_view_question(user, q):
        return jsonify({'error': 'Forbidden'}), 403

    content = (data.get('content') or '').strip()
    images = data.get('images') or []
    if not content and not images:
        return jsonify({'error': 'Missing reply content'}), 400

    audit_result = audit_text_content(content, user.openid)
    if not audit_result.get('ok'):
        return jsonify({'error': audit_result.get('message') or '内容审核未通过'}), 400
        
    reply = Reply(
        question_id=qid,
        user_id=user.id,
        content=content
    )
    db.session.add(reply)
    db.session.flush()

    for image_url in images:
        if image_url:
            db.session.add(ReplyImage(reply_id=reply.id, image_url=image_url))

    db.session.commit()
    
    return jsonify({'success': True})


@app.route('/api/questions/<int:qid>/star', methods=['POST'])
def toggle_star(qid):
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    question = Question.query.get_or_404(qid)
    if not can_view_question(user, question):
        return jsonify({'error': 'Forbidden'}), 403
    if not question.is_public or question.review_status != 'approved' or question.audit_status != 'passed':
        return jsonify({'error': 'Only approved public questions can be starred'}), 400

    star = Star.query.filter_by(user_id=user.id, question_id=qid).first()
    if star:
        db.session.delete(star)
        question.stars = max((question.stars or 0) - 1, 0)
        starred = False
    else:
        db.session.add(Star(user_id=user.id, question_id=qid))
        question.stars = (question.stars or 0) + 1
        starred = True

    db.session.commit()
    return jsonify({'success': True, 'starred': starred, 'stars': question.stars})


@app.route('/api/teacher/questions/<int:qid>', methods=['DELETE'])
def delete_teacher_question(qid):
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    question = Question.query.get_or_404(qid)
    if not question.is_public and question.counselor_id not in {user.id, 0}:
        return jsonify({'error': 'Forbidden'}), 403

    replies = Reply.query.filter_by(question_id=question.id).all()
    for reply in replies:
        for image in reply.images:
            remove_uploaded_file_by_url(image.image_url)
            db.session.delete(image)
        db.session.delete(reply)

    Star.query.filter_by(question_id=question.id).delete()
    db.session.delete(question)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/teacher/questions/<int:qid>/review', methods=['POST'])
def review_teacher_question(qid):
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    question = Question.query.get_or_404(qid)
    if not question.is_public:
        return jsonify({'error': 'Only public questions can be reviewed'}), 400
    if question.audit_status != 'passed':
        return jsonify({'error': 'Question is still under system review'}), 400

    payload = request.json or {}
    action = payload.get('action')
    reason = (payload.get('reason') or '').strip()
    if action not in {'approve', 'reject'}:
        return jsonify({'error': 'Invalid review action'}), 400

    if action == 'approve':
        question.review_status = 'approved'
        question.review_reason = None
    else:
        question.review_status = 'rejected'
        question.review_reason = reason[:255] if reason else None

    db.session.commit()
    return jsonify({'success': True, **serialize_question_review(question)})


@app.route('/api/teacher/replies/<int:reply_id>', methods=['DELETE'])
def delete_teacher_reply(reply_id):
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    reply = Reply.query.get_or_404(reply_id)
    question = Question.query.get_or_404(reply.question_id)
    if not question.is_public and question.counselor_id not in {user.id, 0}:
        return jsonify({'error': 'Forbidden'}), 403

    for image in reply.images:
        remove_uploaded_file_by_url(image.image_url)
        db.session.delete(image)

    db.session.delete(reply)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/my/conversations/<int:counselor_id>', methods=['GET'])
def get_my_conversation(counselor_id):
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    questions = Question.query.options(
        selectinload(Question.replies_list).joinedload(Reply.user),
        selectinload(Question.replies_list).selectinload(Reply.images)
    ).filter(
        Question.user_id == user.id,
        Question.is_public.is_(False),
        Question.counselor_id == counselor_id
    ).order_by(
        Question.created_at.asc(),
        Question.id.asc()
    ).all()

    items = []
    for question in questions:
        items.append({
            'id': f'q-{question.id}',
            'questionId': question.id,
            'kind': 'question',
            'senderRole': 'student',
            'senderName': '我',
            'senderAvatarUrl': '',
            'isMine': True,
            'content': question.content,
            'images': [],
            'time': question.created_at.strftime('%Y-%m-%d %H:%M')
        })

        replies = sorted(
            question.replies_list,
            key=lambda reply: (reply.created_at, reply.id)
        )
        for reply in replies:
            items.append({
                'id': f'r-{reply.id}',
                'questionId': question.id,
                'kind': 'reply',
                'senderRole': reply.user.role if reply.user else 'teacher',
                'senderName': (reply.user.nickname if reply.user and reply.user.nickname else '教师'),
                'senderAvatarUrl': (reply.user.avatar_url if reply.user and reply.user.avatar_url else ''),
                'isMine': reply.user_id == user.id,
                'content': build_reply_preview(reply) or '',
                'images': [image.image_url for image in reply.images],
                'time': reply.created_at.strftime('%Y-%m-%d %H:%M')
            })

    latest_question = questions[-1] if questions else None
    return jsonify({
        'items': items,
        'defaults': {
            'isAnonymous': latest_question.is_anonymous if latest_question else False,
            'studentClass': latest_question.student_class if latest_question and latest_question.student_class else '',
            'studentName': latest_question.student_name if latest_question and latest_question.student_name else ''
        }
    })

# 我的提问
@app.route('/api/my/questions', methods=['GET'])
def get_my_questions():
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
        
    questions = Question.query.filter_by(user_id=user.id).order_by(Question.created_at.desc()).all()
    summary_map = build_question_summary_map([question.id for question in questions])
    return jsonify([{
        'id': q.id,
        'content': q.content,
        'time': q.created_at.strftime('%Y-%m-%d %H:%M'),
        'reply': summary_map.get(q.id, {}).get('teacherReply'),
        'hasTeacherReply': summary_map.get(q.id, {}).get('hasTeacherReply', False),
        'isPublic': q.is_public,
        **serialize_question_review(q)
    } for q in questions])

# 我的回复
@app.route('/api/my/replies', methods=['GET'])
def get_my_replies():
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
        
    # 查询我回复过的问题
    # 这是一个简化查询，实际可能需要去重
    replies = Reply.query.filter_by(user_id=user.id).order_by(Reply.created_at.desc()).all()
    
    result = []
    seen_qids = set()
    for r in replies:
        if r.question_id not in seen_qids:
            q = Question.query.get(r.question_id)
            if q:
                result.append({
                    'id': q.id,
                    'content': q.content,
                    'my_reply': r.content,
                    'time': r.created_at.strftime('%Y-%m-%d %H:%M')
                })
                seen_qids.add(r.question_id)
                
    return jsonify(result)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)

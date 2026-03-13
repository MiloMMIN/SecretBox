from flask import Flask, jsonify, request, Response, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from celery import Celery
import os
import requests
import urllib.parse
import csv
import io
import uuid
from datetime import datetime
from sqlalchemy import UniqueConstraint, or_
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
    if question.is_public:
        return True

    if not user:
        return False

    if question.user_id == user.id:
        return True

    return user.role == 'teacher' and (question.counselor_id == user.id or question.counselor_id == 0)


def ensure_teacher_user():
    user = get_authenticated_user()
    if not user:
        return None, (jsonify({'error': 'Unauthorized'}), 401)
    if user.role != 'teacher':
        return None, (jsonify({'error': 'Forbidden'}), 403)
    return user, None


def get_teacher_visible_questions(user):
    return Question.query.filter(
        or_(Question.is_public.is_(True), Question.counselor_id == user.id, Question.counselor_id == 0)
    ).order_by(Question.created_at.desc()).all()


def serialize_teacher_question(question):
    latest_reply = get_latest_reply(question.id)
    latest_teacher_reply = get_latest_teacher_reply(question.id)

    student = None
    if not question.is_anonymous and (question.student_name or question.student_class):
        student = {
            'name': question.student_name,
            'className': question.student_class
        }

    return {
        'id': question.id,
        'content': question.content,
        'time': question.created_at.strftime('%Y-%m-%d %H:%M'),
        'isPublic': question.is_public,
        'isAnonymous': question.is_anonymous,
        'stars': question.stars,
        'comments': Reply.query.filter_by(question_id=question.id).count(),
        'hasTeacherReply': latest_teacher_reply is not None,
        'latestReplyPreview': build_reply_preview(latest_reply),
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
        user.avatar_url = userInfo.get('avatarUrl')

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
    avatar_url = (data.get('avatarUrl') or '').strip()

    if nickname:
        user.nickname = nickname[:64]
    if avatar_url:
        user.avatar_url = avatar_url[:256]

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
    visible_questions = get_teacher_visible_questions(user)
    today_start = datetime.combine(datetime.now().date(), datetime.min.time())

    pending_questions = [q for q in visible_questions if not get_latest_teacher_reply(q.id)]
    today_questions = [q for q in visible_questions if q.created_at >= today_start]
    inbox_questions = [q for q in visible_questions if q.counselor_id == user.id and not q.is_public]
    square_questions = [q for q in visible_questions if q.is_public]
    unread_questions = visible_questions
    if profile.last_checked_at:
        unread_questions = [q for q in visible_questions if q.created_at > profile.last_checked_at]

    return jsonify({
        'pendingCount': len(pending_questions),
        'todayCount': len(today_questions),
        'inboxCount': len(inbox_questions),
        'squareCount': len(square_questions),
        'unreadCount': len(unread_questions)
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
    questions = get_teacher_visible_questions(user)
    today_start = datetime.combine(datetime.now().date(), datetime.min.time())

    if scope == 'pending':
        questions = [q for q in questions if not get_latest_teacher_reply(q.id)]
    elif scope == 'today':
        questions = [q for q in questions if q.created_at >= today_start]
    elif scope == 'inbox':
        questions = [q for q in questions if q.counselor_id == user.id and not q.is_public]
    elif scope == 'square':
        questions = [q for q in questions if q.is_public]

    return jsonify([serialize_teacher_question(question) for question in questions])


@app.route('/api/teacher/export', methods=['GET'])
def export_teacher_questions():
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    scope = request.args.get('scope', 'all')
    questions = get_teacher_visible_questions(user)
    today_start = datetime.combine(datetime.now().date(), datetime.min.time())

    if scope == 'pending':
        questions = [q for q in questions if not get_latest_teacher_reply(q.id)]
    elif scope == 'today':
        questions = [q for q in questions if q.created_at >= today_start]
    elif scope == 'inbox':
        questions = [q for q in questions if q.counselor_id == user.id and not q.is_public]
    elif scope == 'square':
        questions = [q for q in questions if q.is_public]

    output = io.StringIO()
    writer = csv.writer(output, delimiter='\t')
    writer.writerow(['ID', '类型', '提问时间', '内容', '学生班级', '学生姓名', '是否已被教师回复', '最新评论'])

    for question in questions:
        latest_reply = get_latest_reply(question.id)
        writer.writerow([
            question.id,
            '广场' if question.is_public else '私密',
            question.created_at.strftime('%Y-%m-%d %H:%M'),
            question.content,
            question.student_class or '',
            question.student_name or '',
            '是' if get_latest_teacher_reply(question.id) else '否',
            build_reply_preview(latest_reply) or ''
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
    user = get_authenticated_user()
    
    query = Question.query.filter_by(is_public=True)
    
    if search:
        query = query.filter(Question.content.contains(search))
        
    if sort == 'hot':
        query = query.order_by(Question.stars.desc())
    elif sort == 'discuss':
        # 简单实现，暂不支持按评论数排序，仍按时间
        query = query.order_by(Question.created_at.desc())
    else:
        query = query.order_by(Question.created_at.desc())
        
    questions = query.all()
    
    result = []
    for q in questions:
        latest_reply = get_latest_reply(q.id)
        latest_teacher_reply = get_latest_teacher_reply(q.id)
        reply_count = Reply.query.filter_by(question_id=q.id).count()
        starred = False
        if user:
            starred = Star.query.filter_by(user_id=user.id, question_id=q.id).first() is not None
        
        result.append({
            'id': q.id,
            'content': q.content,
            'time': q.created_at.strftime('%Y-%m-%d %H:%M'),
            'stars': q.stars,
            'comments': reply_count,
            'reply': latest_teacher_reply.content if latest_teacher_reply else None,
            'latestReplyPreview': build_reply_preview(latest_reply),
            'hasTeacherReply': latest_teacher_reply is not None,
            'isPublic': q.is_public,
            'user': get_question_author_payload(q),
            'starred': starred
        })
        
    return jsonify(result)

# 获取问题详情及回复
@app.route('/api/questions/<int:qid>', methods=['GET'])
def get_question_detail(qid):
    q = Question.query.get_or_404(qid)
    user = get_authenticated_user()
    if not can_view_question(user, q):
        return jsonify({'error': 'Forbidden'}), 403

    replies = Reply.query.filter_by(question_id=qid).order_by(Reply.created_at.asc()).all()
    starred = False
    if user:
        starred = Star.query.filter_by(user_id=user.id, question_id=q.id).first() is not None
        
    return jsonify({
        'id': q.id,
        'content': q.content,
        'time': q.created_at.strftime('%Y-%m-%d %H:%M'),
        'stars': q.stars,
        'starred': starred,
        'isPublic': q.is_public,
        'user': get_question_author_payload(q),
        'latestReplyPreview': build_reply_preview(get_latest_reply(q.id)),
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
        
    q = Question(
        content=content,
        user_id=user.id,
        counselor_id=data.get('counselorId'),
        is_anonymous=data.get('isAnonymous', False),
        is_public=data.get('isPublic', False),
        student_class=data.get('studentClass'),
        student_name=data.get('studentName')
    )
    db.session.add(q)
    db.session.commit()
    
    return jsonify({'success': True, 'id': q.id})

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

# 我的提问
@app.route('/api/my/questions', methods=['GET'])
def get_my_questions():
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
        
    questions = Question.query.filter_by(user_id=user.id).order_by(Question.created_at.desc()).all()
    return jsonify([{
        'id': q.id,
        'content': q.content,
        'time': q.created_at.strftime('%Y-%m-%d %H:%M'),
        'reply': get_latest_teacher_reply(q.id).content if get_latest_teacher_reply(q.id) else None,
        'hasTeacherReply': get_latest_teacher_reply(q.id) is not None
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

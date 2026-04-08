from flask import Flask, jsonify, request, Response, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from celery import Celery
import os
import requests
import urllib.parse
import csv
import io
import uuid
import base64
import hashlib
import hmac
from datetime import datetime, timedelta
from sqlalchemy import UniqueConstraint, and_, func, or_
from sqlalchemy.exc import IntegrityError
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
    # 外部访问 URL（用于生成文件链接，适用于反向代理场景）
    EXTERNAL_URL = os.getenv('EXTERNAL_URL', '')

    # 角色配置
    TEACHER_OPENIDS = [
        openid.strip() for openid in os.getenv('TEACHER_OPENIDS', '').split(',') if openid.strip()
    ]
    TEACHER_INVITE_CODE = os.getenv('TEACHER_INVITE_CODE', '').strip()
    DINGTALK_WEBHOOK_URL = os.getenv('DINGTALK_WEBHOOK_URL', '').strip()
    DINGTALK_WEBHOOK_SECRET = os.getenv('DINGTALK_WEBHOOK_SECRET', '').strip()

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
LOCAL_TIME_OFFSET_HOURS = 8
APPOINTMENT_SLOT_STARTS = [
    '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
    '14:00', '14:30', '15:00', '15:30'
]
APPOINTMENT_DURATION_MINUTES = 30


def parse_positive_int(value, default):
    try:
        parsed = int(value)
        return parsed if parsed > 0 else default
    except (TypeError, ValueError):
        return default


def get_local_now():
    return datetime.utcnow() + timedelta(hours=LOCAL_TIME_OFFSET_HOURS)


def get_appointment_slot_end(slot_start):
    if slot_start not in APPOINTMENT_SLOT_STARTS:
        return None

    slot_dt = datetime.strptime(slot_start, '%H:%M')
    return (slot_dt + timedelta(minutes=APPOINTMENT_DURATION_MINUTES)).strftime('%H:%M')


def parse_month_key(month_key):
    try:
        month_date = datetime.strptime(month_key, '%Y-%m')
    except (TypeError, ValueError):
        return None

    return datetime(month_date.year, month_date.month, 1)


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
                'checked_at': datetime.utcnow(),
                'raw': data
            }

        return {
            'ok': True,
            'reason': 'pass',
            'checked_at': datetime.utcnow(),
            'raw': data
        }

    if data.get('errcode') == 87014:
        return {
            'ok': False,
            'message': '内容包含敏感信息，请修改后重试',
            'reason': 'risky',
            'checked_at': datetime.utcnow(),
            'raw': data
        }

    raise ValueError(data.get('errmsg') or '微信内容安全校验失败')


def run_wechat_image_security_check(image_url, openid=''):
    """调用微信图片内容安全检测 API"""
    access_token = get_wechat_access_token()
    url = f'https://api.weixin.qq.com/wxa/img_sec_check?access_token={access_token}'

    # 下载图片
    image_response = requests.get(image_url, timeout=10)
    image_response.raise_for_status()

    # 构建 multipart/form-data 请求
    files = {'media': ('image.jpg', image_response.content, 'image/jpeg')}
    data = {}
    if openid:
        data['openid'] = openid
        data['scene'] = 2
        data['version'] = 2

    response = requests.post(url, files=files, data=data, timeout=10)
    data = response.json()

    if data.get('errcode') == 0:
        result = data.get('result') or {}
        suggest = result.get('suggest', 'pass')
        if suggest in {'risky', 'review'}:
            return {
                'ok': False,
                'message': '图片包含敏感信息',
                'reason': suggest,
                'checked_at': datetime.utcnow(),
                'raw': data
            }
        return {
            'ok': True,
            'reason': 'pass',
            'checked_at': datetime.utcnow(),
            'raw': data
        }

    if data.get('errcode') == 87014:
        return {
            'ok': False,
            'message': '图片包含敏感信息',
            'reason': 'risky',
            'checked_at': datetime.utcnow(),
            'raw': data
        }

    raise ValueError(data.get('errmsg') or '微信图片安全校验失败')


def audit_text_content(content, openid=''):
    checked_at = datetime.utcnow()
    if not content:
        return {'ok': True, 'checked_at': checked_at}

    if not is_wechat_configured():
        return {'ok': True, 'skipped': True, 'reason': 'wechat_not_configured', 'checked_at': checked_at}

    try:
        result = run_wechat_text_security_check(content, openid)
        return result
    except Exception as exc:
        print(f'Warning: WeChat content security check skipped due to error: {exc}')
        return {'ok': True, 'skipped': True, 'reason': 'wechat_check_failed', 'checked_at': checked_at}


def audit_image_content(image_url, openid=''):
    """审核图片内容，返回审核结果"""
    checked_at = datetime.utcnow()
    if not image_url:
        return {'ok': True, 'checked_at': checked_at}

    if not is_wechat_configured():
        return {'ok': True, 'skipped': True, 'reason': 'wechat_not_configured', 'checked_at': checked_at}

    try:
        return run_wechat_image_security_check(image_url, openid)
    except Exception as exc:
        print(f'Warning: WeChat image security check skipped due to error: {exc}')
        return {'ok': True, 'skipped': True, 'reason': 'wechat_check_failed', 'checked_at': checked_at}

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
        'avatarUrl': '',
        'role': user.role
    }


def get_or_create_teacher_profile(user):
    profile = TeacherProfile.query.filter_by(user_id=user.id).first()
    if not profile:
        profile = TeacherProfile(
            user_id=user.id,
            display_name=user.nickname,
            avatar_url='',
            description='已认证教师'
        )
        db.session.add(profile)
        db.session.flush()
    return profile


def serialize_teacher_profile(user, profile=None):
    profile = profile or TeacherProfile.query.filter_by(user_id=user.id).first()
    display_name = (profile.display_name if profile and profile.display_name else user.nickname) or '未命名教师'
    avatar_url = (profile.avatar_url if profile and profile.avatar_url else '') or ''
    description = (profile.description if profile and profile.description else '已认证教师')
    is_active = True if profile is None else profile.is_active
    return {
        'kind': 'teacher',
        'id': user.id,
        'nickName': display_name,
        'avatarUrl': ensure_absolute_file_url(avatar_url),
        'desc': description,
        'isActive': is_active
    }


def serialize_teacher_invite(invite):
    return {
        'kind': 'invite',
        'id': invite.id,
        'nickName': invite.display_name or '待激活教师',
        'avatarUrl': ensure_absolute_file_url(invite.avatar_url or ''),
        'desc': invite.description or '待教师本人激活',
        'isActive': invite.is_active,
        'inviteCode': invite.invite_code,
        'claimed': invite.claimed_user_id is not None
    }


def get_teacher_display_name(user, profile=None):
    if not user:
        return '未命名教师'

    active_profile = profile
    if active_profile is None:
        active_profile = getattr(user, 'teacher_profile', None)

    return (active_profile.display_name if active_profile and active_profile.display_name else user.nickname) or '未命名教师'


def serialize_appointment(appointment):
    teacher_profile = getattr(appointment.teacher, 'teacher_profile', None) if appointment.teacher else None
    return {
        'id': appointment.id,
        'date': appointment.appointment_date.strftime('%Y-%m-%d'),
        'slotStart': appointment.slot_start,
        'slotEnd': appointment.slot_end,
        'teacherId': appointment.teacher_id,
        'teacherName': get_teacher_display_name(appointment.teacher, teacher_profile),
        'durationMinutes': appointment.duration_minutes,
        'status': appointment.status
    }


def build_dingtalk_webhook_url():
    webhook_url = app.config.get('DINGTALK_WEBHOOK_URL', '').strip()
    webhook_secret = app.config.get('DINGTALK_WEBHOOK_SECRET', '').strip()
    if not webhook_url:
        return '', webhook_secret

    if not webhook_secret:
        return webhook_url, webhook_secret

    timestamp = str(int(datetime.utcnow().timestamp() * 1000))
    string_to_sign = f'{timestamp}\n{webhook_secret}'
    digest = hmac.new(
        webhook_secret.encode('utf-8'),
        string_to_sign.encode('utf-8'),
        digestmod=hashlib.sha256
    ).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(digest).decode('utf-8'))
    separator = '&' if '?' in webhook_url else '?'
    return f'{webhook_url}{separator}timestamp={timestamp}&sign={sign}', webhook_secret


def send_dingtalk_appointment_notification(appointment):
    webhook_url, _ = build_dingtalk_webhook_url()
    if not webhook_url:
        return 'skipped', '预约已经保存，但尚未配置钉钉 webhook，当前不会推送到群聊。'

    appointment_time = f"{appointment.appointment_date.strftime('%Y-%m-%d')} {appointment.slot_start}-{appointment.slot_end}"
    teacher_name = get_teacher_display_name(appointment.teacher, getattr(appointment.teacher, 'teacher_profile', None) if appointment.teacher else None)
    payload = {
        'msgtype': 'text',
        'text': {
            'content': (
                '【智梦心坊】\n'
                '【您有一条梦团订单，请查收】\n'
                f'预约人：{appointment.student_name}\n'
                f'预约人班级：{appointment.student_class}\n'
                f'预约时间：{appointment_time}\n'
                f'预约老师：{teacher_name}'
            )
        }
    }

    try:
        response = requests.post(webhook_url, json=payload, timeout=5)
        response.raise_for_status()
        body = response.json() if response.content else {}
    except Exception as exc:
        return 'failed', f'预约已保存，但钉钉通知发送失败：{exc}'

    if isinstance(body, dict) and body.get('errcode') not in {None, 0, '0'}:
        return 'failed', f"预约已保存，但钉钉通知发送失败：{body.get('errmsg') or '未知错误'}"

    return 'sent', '钉钉通知已发送'


def prefer_https_url(url):
    if not url:
        return ''

    parsed = urlparse(url)
    hostname = (parsed.hostname or '').lower()
    if parsed.scheme != 'http':
        return url
    if hostname in {'localhost', '127.0.0.1', '::1'}:
        return url
    if hostname.startswith('10.') or hostname.startswith('192.168.'):
        return url
    return parsed._replace(scheme='https').geturl()


def build_file_url(filename):
    """Build a full URL for an uploaded file.

    Uses EXTERNAL_URL config if available, otherwise falls back to request.host_url.
    This is important for production deployments where the app runs behind a reverse proxy.
    """
    external_url = app.config.get('EXTERNAL_URL')
    if external_url:
        base_url = external_url.rstrip('/')
    else:
        base_url = request.host_url.rstrip('/')
        
    if base_url.endswith('/api'):
        return prefer_https_url(f"{base_url}/uploads/{filename}")
    else:
        return prefer_https_url(f"{base_url}/api/uploads/{filename}")


def ensure_absolute_file_url(url):
    """Ensure a file URL is absolute and uses the current environment's base URL.
    
    This fixes stale URLs in the database (e.g. from a different domain or protocol).
    """
    if not url:
        return ''
    
    # If it's a local WeChat path or already doesn't contain /uploads/, return as is
    if '/uploads/' not in url:
        return prefer_https_url(url)
    
    # Extract filename and rebuild using current host
    try:
        filename = url.rsplit('/uploads/', 1)[-1]
        # Remove any query parameters if present
        filename = filename.split('?')[0]
        return prefer_https_url(build_file_url(filename))
    except Exception:
        return prefer_https_url(url)


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
    
    # support both /uploads/ and /api/uploads/
    if '/api/uploads/' in parsed.path:
        filename = parsed.path.rsplit('/api/uploads/', 1)[-1]
    elif '/uploads/' in parsed.path:
        filename = parsed.path.rsplit('/uploads/', 1)[-1]
    else:
        return

    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass


def get_visible_user_avatar_url(user):
    if not user or user.role != 'teacher':
        return ''

    profile = getattr(user, 'teacher_profile', None)
    if not profile or not profile.avatar_url:
        return ''

    return ensure_absolute_file_url(profile.avatar_url)


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
        'avatarUrl': get_visible_user_avatar_url(question.user),
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
    """获取教师已回复的问题ID查询，仅包含审核通过的回复"""
    return db.session.query(Reply.question_id).join(
        User, Reply.user_id == User.id
    ).filter(
        Reply.audit_status == 'passed',
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

    # 构建查询 - 仅包含审核通过的回复
    reply_count_rows = []
    try:
        reply_count_rows = db.session.query(
            Reply.question_id,
            func.count(Reply.id)
        ).filter(
            Reply.question_id.in_(question_ids),
            Reply.audit_status == 'passed'
        ).group_by(
            Reply.question_id
        ).all()
    except Exception:
        # audit_status 字段可能不存在，忽略过滤条件
        try:
            reply_count_rows = db.session.query(
                Reply.question_id,
                func.count(Reply.id)
            ).filter(
                Reply.question_id.in_(question_ids)
            ).group_by(
                Reply.question_id
            ).all()
        except Exception:
            pass
    for question_id, reply_count in reply_count_rows:
        summary_map[question_id]['comments'] = reply_count

    replies = []
    try:
        replies = Reply.query.options(
            joinedload(Reply.user),
            selectinload(Reply.images)
        ).filter(
            Reply.question_id.in_(question_ids),
            Reply.audit_status == 'passed'
        ).order_by(
            Reply.question_id.asc(),
            Reply.created_at.desc()
        ).all()
    except Exception:
        # audit_status 字段可能不存在，忽略过滤条件
        try:
            replies = Reply.query.options(
                joinedload(Reply.user),
                selectinload(Reply.images)
            ).filter(
                Reply.question_id.in_(question_ids)
            ).order_by(
                Reply.question_id.asc(),
                Reply.created_at.desc()
            ).all()
        except Exception:
            pass

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


def serialize_reply(reply, include_audit=False):
    result = {
        'id': reply.id,
        'content': reply.content,
        'time': reply.created_at.strftime('%Y-%m-%d %H:%M'),
        'images': [ensure_absolute_file_url(image.image_url) for image in reply.images],
        'user': {
            'nickname': reply.user.nickname,
            'avatarUrl': get_visible_user_avatar_url(reply.user),
            'role': reply.user.role
        }
    }
    if include_audit:
        try:
            result['auditStatus'] = reply.audit_status
        except Exception:
            result['auditStatus'] = 'passed'  # 字段不存在时默认为 passed
    return result


def get_latest_teacher_reply(question_id):
    try:
        return Reply.query.join(User, Reply.user_id == User.id).filter(
            Reply.question_id == question_id,
            Reply.audit_status == 'passed',
            User.role == 'teacher'
        ).order_by(Reply.created_at.desc()).first()
    except Exception:
        # audit_status 字段可能不存在
        return Reply.query.join(User, Reply.user_id == User.id).filter(
            Reply.question_id == question_id,
            User.role == 'teacher'
        ).order_by(Reply.created_at.desc()).first()


def get_latest_reply(question_id):
    try:
        return Reply.query.filter_by(
            question_id=question_id,
            audit_status='passed'
        ).order_by(Reply.created_at.desc()).first()
    except Exception:
        # audit_status 字段可能不存在
        return Reply.query.filter_by(
            question_id=question_id
        ).order_by(Reply.created_at.desc()).first()


def can_view_question(user, question):
    try:
        audit_status = question.audit_status
    except Exception:
        # audit_status 字段可能不存在，假设已通过
        audit_status = 'passed'

    if audit_status != 'passed':
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
        'reviewStatusText': get_question_review_label(question.review_status)
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

    # 教师可以看到审核通过或审核中的问题（只要不是被拒绝的）
    # 注意：audit_status 过滤在查询执行时通过异常处理保护
    return query.filter(
        Question.audit_status.in_(['passed', 'pending', 'failed']),
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
        query = query.filter(Question.created_at >= today_start)
    elif scope == 'inbox':
        # 树洞信箱只展示私密树洞消息，不混入广场内容
        query = query.filter(
            and_(
                or_(
                    Question.counselor_id == user.id,
                    Question.counselor_id == 0
                ),
                Question.is_public.is_(False)
            )
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
    # 审核字段
    audit_status = db.Column(db.String(20), default='pending', nullable=False)
    audit_checked_at = db.Column(db.DateTime)

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


class Appointment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    teacher_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    student_name = db.Column(db.String(64), nullable=False)
    student_class = db.Column(db.String(64), nullable=False)
    appointment_date = db.Column(db.Date, nullable=False)
    slot_start = db.Column(db.String(5), nullable=False)
    slot_end = db.Column(db.String(5), nullable=False)
    duration_minutes = db.Column(db.Integer, nullable=False, default=APPOINTMENT_DURATION_MINUTES)
    status = db.Column(db.String(20), nullable=False, default='booked')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    creator = db.relationship('User', foreign_keys=[user_id], backref=db.backref('appointments', lazy=True))
    teacher = db.relationship('User', foreign_keys=[teacher_id], backref=db.backref('appointment_assignments', lazy=True))

    __table_args__ = (
        UniqueConstraint('appointment_date', 'slot_start', name='uq_appointment_room_slot'),
    )

# 自动建表 (移至 init_db.py 中统一处理，避免 import 时触发连接错误)
# with app.app_context():
#    db.create_all()


@celery.task(bind=True, name='tasks.audit_question')
def audit_question(self, question_id):
    """审核问题内容（适用于所有问题，包括私密和公开）"""
    with app.app_context():
        question = Question.query.options(joinedload(Question.user)).filter_by(id=question_id).first()
        if not question:
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
                db.session.commit()
                raise

            raise self.retry(exc=exc, countdown=min(30 * (self.request.retries + 1), 180))

        question.audit_checked_at = audit_result.get('checked_at') or datetime.utcnow()
        if audit_result.get('ok'):
            question.audit_status = 'passed'
        else:
            question.audit_status = 'rejected'
            # 只有公开问题才需要同步修改 review_status
            if question.is_public:
                question.review_status = 'rejected'

        db.session.commit()
        return {'status': question.audit_status}


@celery.task(bind=True, name='tasks.audit_reply')
def audit_reply(self, reply_id):
    """审核回复内容（包括文字和图片）"""
    with app.app_context():
        reply = Reply.query.options(
            joinedload(Reply.user),
            joinedload(Reply.images)
        ).filter_by(id=reply_id).first()
        if not reply:
            return {'status': 'skipped'}

        if reply.audit_status == 'passed':
            return {'status': 'passed'}

        openid = reply.user.openid if reply.user else ''
        checked_at = datetime.utcnow()

        # 1. 审核文字内容
        if reply.content and is_wechat_configured():
            try:
                text_result = run_wechat_text_security_check(reply.content, openid)
                checked_at = text_result.get('checked_at') or checked_at
                if not text_result.get('ok'):
                    reply.audit_status = 'rejected'
                    reply.audit_checked_at = checked_at
                    db.session.commit()
                    return {'status': 'rejected', 'reason': 'text_content_risky'}
            except Exception as exc:
                if self.request.retries >= 3:
                    reply.audit_status = 'failed'
                    reply.audit_checked_at = checked_at
                    db.session.commit()
                    raise
                raise self.retry(exc=exc, countdown=min(30 * (self.request.retries + 1), 180))

        # 2. 审核图片内容
        for image in reply.images:
            if image.image_url and is_wechat_configured():
                try:
                    image_result = run_wechat_image_security_check(image.image_url, openid)
                    checked_at = image_result.get('checked_at') or checked_at
                    if not image_result.get('ok'):
                        reply.audit_status = 'rejected'
                        reply.audit_checked_at = checked_at
                        db.session.commit()
                        return {'status': 'rejected', 'reason': 'image_content_risky'}
                except Exception as exc:
                    if self.request.retries >= 3:
                        reply.audit_status = 'failed'
                        reply.audit_checked_at = checked_at
                        db.session.commit()
                        raise
                    raise self.retry(exc=exc, countdown=min(30 * (self.request.retries + 1), 180))

        # 全部通过
        reply.audit_status = 'passed'
        reply.audit_checked_at = checked_at
        db.session.commit()
        return {'status': 'passed'}


# 保留旧的任务名兼容性
@celery.task(bind=True, name='tasks.audit_public_question')
def audit_public_question(self, question_id):
    """兼容旧任务名，委托给新的 audit_question"""
    return audit_question(self, question_id)


# --- API ---

@app.route('/')
def hello():
    return "Wisdom Heart Tree Hole API V1.0 Running"


@app.route('/api/uploads/<path:filename>', methods=['GET'])
def uploaded_file(filename):
    """Serve uploaded files with proper CORS headers for WeChat Mini Program.

    WeChat Mini Programs require proper CORS headers to load images from external domains.
    """
    response = send_from_directory(app.config['UPLOAD_FOLDER'], filename)
    # Add CORS headers for WeChat Mini Program image loading
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    return response


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
        nickname = (userInfo.get('nickName') or '').strip()
        if nickname:
            user.nickname = nickname[:64]

    db.session.flush()
    if user.role == 'teacher':
        profile = get_or_create_teacher_profile(user)
        if user.nickname and not profile.display_name:
            profile.display_name = user.nickname

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

    if nickname:
        user.nickname = nickname[:64]

    if user.role == 'teacher':
        profile = get_or_create_teacher_profile(user)
        if nickname:
            profile.display_name = user.nickname

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
        profile.avatar_url = teacher_invite.avatar_url or ''
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


@app.route('/api/appointments/calendar', methods=['GET'])
def get_appointment_calendar():
    month_key = (request.args.get('month') or '').strip()
    local_now = get_local_now()
    month_date = parse_month_key(month_key or local_now.strftime('%Y-%m'))
    if not month_date:
        return jsonify({'error': 'Invalid month'}), 400

    next_month = datetime(month_date.year + (1 if month_date.month == 12 else 0), 1 if month_date.month == 12 else month_date.month + 1, 1)
    try:
        appointments = Appointment.query.options(
            joinedload(Appointment.teacher).joinedload(User.teacher_profile)
        ).filter(
            Appointment.appointment_date >= month_date.date(),
            Appointment.appointment_date < next_month.date(),
            Appointment.status == 'booked'
        ).order_by(Appointment.appointment_date.asc(), Appointment.slot_start.asc()).all()
    except Exception as exc:
        print(f'Warning: appointment calendar query failed: {exc}')
        appointments = []

    return jsonify({
        'month': month_date.strftime('%Y-%m'),
        'monthLabel': f"{month_date.year} 年 {month_date.month:02d} 月",
        'appointments': [serialize_appointment(item) for item in appointments]
    })


@app.route('/api/appointments', methods=['POST'])
def create_appointment():
    data = request.json or {}
    user = get_authenticated_user()
    student_name = (data.get('studentName') or '').strip()
    student_class = (data.get('studentClass') or '').strip()
    date_value = (data.get('date') or '').strip()
    slot_start = (data.get('slotStart') or '').strip()

    try:
        teacher_id = int(data.get('teacherId'))
    except (TypeError, ValueError):
        teacher_id = 0

    if not student_name:
        return jsonify({'error': 'Missing studentName'}), 400
    if not student_class:
        return jsonify({'error': 'Missing studentClass'}), 400
    if not date_value:
        return jsonify({'error': 'Missing date'}), 400

    slot_end = get_appointment_slot_end(slot_start)
    if not slot_end:
        return jsonify({'error': 'Invalid slotStart'}), 400

    try:
        appointment_date = datetime.strptime(date_value, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid date'}), 400

    teacher = User.query.options(joinedload(User.teacher_profile)).filter_by(id=teacher_id, role='teacher').first()
    if not teacher:
        return jsonify({'error': 'Teacher not found'}), 404

    teacher_profile = getattr(teacher, 'teacher_profile', None)
    if teacher_profile and teacher_profile.is_active is False:
        return jsonify({'error': 'Teacher is unavailable'}), 400

    local_now = get_local_now()
    if appointment_date < local_now.date():
        return jsonify({'error': 'Cannot book past dates'}), 400

    if appointment_date == local_now.date():
        appointment_start = datetime.strptime(f'{date_value} {slot_start}', '%Y-%m-%d %H:%M')
        if appointment_start <= local_now:
            return jsonify({'error': 'Selected slot has passed'}), 400

    appointment = Appointment(
        user_id=user.id if user else None,
        teacher_id=teacher.id,
        student_name=student_name[:64],
        student_class=student_class[:64],
        appointment_date=appointment_date,
        slot_start=slot_start,
        slot_end=slot_end,
        duration_minutes=APPOINTMENT_DURATION_MINUTES,
        status='booked'
    )

    db.session.add(appointment)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': '该时段已被预约，请选择其他时间'}), 409

    appointment = Appointment.query.options(
        joinedload(Appointment.teacher).joinedload(User.teacher_profile)
    ).filter_by(id=appointment.id).first()
    notification_status, notification_message = send_dingtalk_appointment_notification(appointment)

    return jsonify({
        'success': True,
        'appointment': serialize_appointment(appointment),
        'notificationStatus': notification_status,
        'notificationMessage': notification_message
    }), 201


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
    avatar_url = sanitize_avatar_url(data.get('avatarUrl'))
    description = (data.get('desc') or '').strip() or '待教师本人激活'
    is_active = bool(data.get('isActive', True))
    invite_code = uuid.uuid4().hex[:8].upper()

    invite = TeacherInvite(
        invite_code=invite_code,
        display_name=display_name[:64],
        avatar_url=avatar_url[:512] if avatar_url else '',
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
    avatar_url = sanitize_avatar_url(data.get('avatarUrl'))
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
    avatar_url = sanitize_avatar_url(data.get('avatarUrl'))
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

    db.session.commit()
    return jsonify({'success': True, 'profile': serialize_teacher_profile(teacher, profile)})


@app.route('/api/teacher/profiles/<int:teacher_id>', methods=['DELETE'])
def delete_teacher_profile(teacher_id):
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    teacher = User.query.get_or_404(teacher_id)
    if teacher.role != 'teacher':
        return jsonify({'error': 'Target is not teacher'}), 400

    # Prevent self-deletion
    if teacher.id == user.id:
        return jsonify({'error': 'Cannot delete yourself'}), 400

    try:
        # Delete teacher profile
        profile = TeacherProfile.query.filter_by(user_id=teacher.id).first()
        if profile:
            db.session.delete(profile)

        # Update role to student
        teacher.role = 'student'

        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Delete failed: {str(e)}'}), 500


@app.route('/api/teacher/dashboard', methods=['GET'])
def get_teacher_dashboard():
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    profile = get_or_create_teacher_profile(user)
    today_start = datetime.combine(datetime.now().date(), datetime.min.time())

    def safe_count(query):
        """安全执行count查询"""
        try:
            return query.count()
        except Exception:
            return 0

    def safe_count_for_scope(scope, review_status='all'):
        """安全执行特定scope的count查询"""
        try:
            base_query = build_teacher_visible_question_query(user)
            scoped_query = apply_teacher_question_scope(
                base_query, user, scope,
                review_status=review_status,
                today_start=today_start
            )
            return scoped_query.count()
        except Exception:
            return 0

    # 分别计算每个计数
    pending_count = safe_count_for_scope('pending')
    review_pending_count = safe_count_for_scope('square', review_status='pending')
    today_count = safe_count_for_scope('today')
    inbox_count = safe_count_for_scope('inbox')
    square_count = safe_count_for_scope('square')

    # unreadCount 单独处理
    try:
        base_query = build_teacher_visible_question_query(user)
        unread_query = base_query
        if profile.last_checked_at:
            unread_query = unread_query.filter(Question.created_at > profile.last_checked_at)
        unread_count = unread_query.count()
    except Exception:
        unread_count = 0

    return jsonify({
        'pendingCount': pending_count,
        'reviewPendingCount': review_pending_count,
        'todayCount': today_count,
        'inboxCount': inbox_count,
        'squareCount': square_count,
        'unreadCount': unread_count
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

    try:
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
    except Exception as e:
        # 查询失败时返回空列表
        return jsonify({
            'items': [],
            'pagination': {
                'page': page,
                'pageSize': page_size,
                'hasMore': False
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
        review_status='approved'
    )
    
    if search:
        query = query.filter(Question.content.contains(search))
        
    if sort == 'hot':
        query = query.order_by(Question.stars.desc())
    elif sort == 'discuss':
        # 简单实现，暂不支持按评论数排序，仍按时间
        query = query.order_by(Question.created_at.desc())
    else:
        query = query.order_by(Question.created_at.desc())

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

    # 构建回复查询
    # 基础条件：审核通过的回复所有人可见
    # 额外条件：回复作者可以看到自己的待审核回复
    # 教师可以看到所有回复
    replies_query = Reply.query.options(
        joinedload(Reply.user),
        selectinload(Reply.images)
    ).filter(
        Reply.question_id == qid
    )

    if user and user.role == 'teacher':
        # 教师可以看到所有回复（包括待审核的）
        replies = replies_query.order_by(Reply.created_at.asc()).all()
    elif user:
        # 普通用户可以看到审核通过的回复，以及自己的待审核回复
        try:
            replies = replies_query.filter(
                db.or_(
                    Reply.audit_status == 'passed',
                    Reply.user_id == user.id
                )
            ).order_by(Reply.created_at.asc()).all()
        except Exception:
            # audit_status 字段可能不存在，显示所有回复
            replies = replies_query.order_by(Reply.created_at.asc()).all()
    else:
        # 未登录用户只能看到审核通过的回复
        try:
            replies = replies_query.filter(
                Reply.audit_status == 'passed'
            ).order_by(Reply.created_at.asc()).all()
        except Exception:
            # audit_status 字段可能不存在，显示所有回复
            replies = replies_query.order_by(Reply.created_at.asc()).all()
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
        'replies': [serialize_reply(reply, include_audit=(user and user.role == 'teacher')) for reply in replies]
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

    # 同步内容审核
    audit_result = audit_text_content(content, user.openid)
    if not audit_result.get('ok'):
        return jsonify({'error': audit_result.get('message') or '内容审核未通过'}), 400

    is_public = bool(data.get('isPublic', False))
    requires_review = is_public

    # 设置初始审核状态为 pending，等待异步审核完成
    # 如果是公开问题，需要人工审核；私密问题直接 approved 但需要异步审核
    q = Question(
        content=content,
        user_id=user.id,
        counselor_id=data.get('counselorId'),
        is_anonymous=data.get('isAnonymous', False),
        is_public=is_public,
        review_status='pending' if requires_review else 'approved',
        audit_status='pending',  # 初始状态为 pending，等待异步审核
        audit_checked_at=audit_result.get('checked_at'),  # 记录同步审核时间
        student_class=data.get('studentClass'),
        student_name=data.get('studentName')
    )
    db.session.add(q)
    db.session.commit()

    # 所有问题都触发异步审核
    audit_question.delay(q.id)

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

    # 同步审核文字内容
    audit_result = audit_text_content(content, user.openid)
    if not audit_result.get('ok'):
        return jsonify({'error': audit_result.get('message') or '内容审核未通过'}), 400

    # 同步审核图片内容
    for image_url in images:
        if image_url:
            image_audit = audit_image_content(image_url, user.openid)
            if not image_audit.get('ok'):
                return jsonify({'error': image_audit.get('message') or '图片审核未通过'}), 400

    reply = Reply(
        question_id=qid,
        user_id=user.id,
        content=content,
        audit_status='pending',  # 初始状态为 pending，等待异步审核
        audit_checked_at=audit_result.get('checked_at')  # 记录同步审核时间
    )
    db.session.add(reply)
    db.session.flush()

    for image_url in images:
        if image_url:
            db.session.add(ReplyImage(reply_id=reply.id, image_url=image_url))

    db.session.commit()

    # 触发异步审核（包括文字和图片）
    audit_reply.delay(reply.id)

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


@app.route('/api/teacher/questions/<int:qid>/review', methods=['POST'])
def review_teacher_question(qid):
    user, error_response = ensure_teacher_user()
    if error_response:
        return error_response

    question = Question.query.get_or_404(qid)
    if not question.is_public:
        return jsonify({'error': 'Only public questions can be reviewed'}), 400

    action = (request.json or {}).get('action')
    if action not in {'approve', 'reject'}:
        return jsonify({'error': 'Invalid review action'}), 400

    question.review_status = 'approved' if action == 'approve' else 'rejected'
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
        
    # 查询我回复过的问题（只显示审核通过的回复）
    try:
        replies = Reply.query.filter_by(
            user_id=user.id,
            audit_status='passed'
        ).order_by(Reply.created_at.desc()).all()
    except Exception:
        # audit_status 字段可能不存在，显示所有回复
        replies = Reply.query.filter_by(
            user_id=user.id
        ).order_by(Reply.created_at.desc()).all()
    
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

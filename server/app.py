from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from celery import Celery
import os
import requests
import urllib.parse
from datetime import datetime

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

    # 角色配置
    TEACHER_OPENIDS = [
        openid.strip() for openid in os.getenv('TEACHER_OPENIDS', '').split(',') if openid.strip()
    ]

app = Flask(__name__)

# 配置
app.config.from_object(Config)

# 微信小程序配置
WX_APP_ID = app.config.get('WX_APP_ID')
WX_APP_SECRET = app.config.get('WX_APP_SECRET')
TEACHER_OPENIDS = set(app.config.get('TEACHER_OPENIDS', []))


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


def resolve_user_role(openid):
    return 'teacher' if openid in TEACHER_OPENIDS else 'student'


def serialize_user(user):
    return {
        'id': user.id,
        'nickName': user.nickname,
        'nickname': user.nickname,
        'avatarUrl': user.avatar_url,
        'role': user.role
    }


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

# 自动建表 (移至 init_db.py 中统一处理，避免 import 时触发连接错误)
# with app.app_context():
#    db.create_all()

# --- API ---

@app.route('/')
def hello():
    return "Wisdom Heart Tree Hole API V1.0 Running"

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
        user.role = resolve_user_role(openid)
    
    # 更新用户信息
    if userInfo:
        user.nickname = userInfo.get('nickName')
        user.avatar_url = userInfo.get('avatarUrl')
    
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

    db.session.commit()
    return jsonify({'success': True, 'userInfo': serialize_user(user)})

# 获取问题广场列表
@app.route('/api/questions', methods=['GET'])
def get_questions():
    search = request.args.get('search', '')
    sort = request.args.get('sort', 'time')
    
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
        # 获取最新的一条回复
        latest_reply = Reply.query.filter_by(question_id=q.id).order_by(Reply.created_at.desc()).first()
        reply_count = Reply.query.filter_by(question_id=q.id).count()
        
        result.append({
            'id': q.id,
            'content': q.content,
            'time': q.created_at.strftime('%Y-%m-%d %H:%M'),
            'stars': q.stars,
            'comments': reply_count,
            'reply': latest_reply.content if latest_reply else None,
            'isPublic': q.is_public,
            'user': get_question_author_payload(q)
        })
        
    return jsonify(result)

# 获取问题详情及回复
@app.route('/api/questions/<int:qid>', methods=['GET'])
def get_question_detail(qid):
    q = Question.query.get_or_404(qid)
    replies = Reply.query.filter_by(question_id=qid).order_by(Reply.created_at.asc()).all()
    
    reply_list = []
    for r in replies:
        reply_list.append({
            'id': r.id,
            'content': r.content,
            'time': r.created_at.strftime('%Y-%m-%d %H:%M'),
            'user': {
                'nickname': r.user.nickname,
                'avatarUrl': r.user.avatar_url
            }
        })
        
    return jsonify({
        'id': q.id,
        'content': q.content,
        'time': q.created_at.strftime('%Y-%m-%d %H:%M'),
        'stars': q.stars,
        'isPublic': q.is_public,
        'user': get_question_author_payload(q),
        'replies': reply_list
    })

# 发布问题
@app.route('/api/questions', methods=['POST'])
def create_question():
    data = request.json
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
        
    q = Question(
        content=data['content'],
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
    data = request.json
    user = get_authenticated_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
        
    reply = Reply(
        question_id=qid,
        user_id=user.id,
        content=data['content']
    )
    db.session.add(reply)
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
        'reply': Reply.query.filter_by(question_id=q.id).order_by(Reply.created_at.desc()).first().content if Reply.query.filter_by(question_id=q.id).first() else None
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

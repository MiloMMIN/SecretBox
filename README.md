# 智心树洞 (Wisdom Heart Tree Hole)

智心树洞是一个为学生与辅导员提供沟通渠道的微信小程序。本项目包含小程序前端代码及服务器部署指南。

## 📁 项目结构

```
SecretBox/
├── app.json            # 小程序全局配置
├── app.js              # 全局逻辑
├── app.wxss            # 全局样式
├── pages/              # 页面目录
│   ├── index/          # 问题广场
│   ├── post/           # 投递/树洞
│   └── profile/        # 个人中心/教师端
└── README.md           # 说明文档
```

## 🚀 快速开始 (前端)

1. 下载并安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 选择 "导入项目"，目录选择本项目根目录 (`SecretBox`)。
3. AppID 使用测试号或您申请的真实 AppID。
4. 编译即可预览。

---

## 🖥️ 服务器端部署指南 (后端)

要在您的服务器上运行完整功能（V1.0），您需要完成以下操作：

### 1. 环境准备

确保您的服务器安装了以下软件：
*   **Docker** & **Docker Compose** (推荐，最简单的部署方式)
*   或者手动安装: Python 3.9+, MySQL 8.0, Redis 6+

### 2. 数据库配置

您需要在 MySQL 中创建一个数据库 `treehole_db`。

```sql
CREATE DATABASE treehole_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 3. 后端服务搭建 (Docker 方式)

在服务器创建一个目录 `treehole-server`，并创建 `docker-compose.yml` 文件：

```yaml
version: '3'
services:
  web:
    image: python:3.9-slim
    volumes:
      - ./app:/app
    working_dir: /app
    command: gunicorn -w 4 -b 0.0.0.0:5000 app:app
    ports:
      - "5000:5000"
    environment:
      - DATABASE_URL=mysql+pymysql://root:password@db/treehole_db
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - db
      - redis

  worker:
    image: python:3.9-slim
    volumes:
      - ./app:/app
    working_dir: /app
    command: celery -A tasks worker --loglevel=info
    environment:
      - DATABASE_URL=mysql+pymysql://root:password@db/treehole_db
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - db
      - redis

  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: password
      MYSQL_DATABASE: treehole_db
    volumes:
      - db_data:/var/lib/mysql

  redis:
    image: redis:6-alpine

volumes:
  db_data:
```

### 4. 必需的后端代码逻辑

您需要编写 Python Flask 代码来实现以下 API 接口：

1.  **用户认证**: `POST /api/login` (接收 `code`, 调用微信 `jscode2session` 获取 `openid`)
2.  **获取问题列表**: `GET /api/questions` (返回公开的问题)
3.  **获取辅导员列表**: `GET /api/counselors`
4.  **投递问题**: `POST /api/questions` (字段: `content`, `counselor_id`, `is_anonymous`, `is_public`)
    *   *重要*: 投递时需调用微信内容安全 API (`msgSecCheck`) 进行文本审核。
5.  **教师端接口**: 获取分配给自己的私密问题。

### 5. 微信平台配置

1.  登录 [微信公众平台](https://mp.weixin.qq.com/)。
2.  在 **开发 -> 开发管理 -> 服务器域名** 中配置您的服务器域名 (request合法域名)。
3.  在 **开发 -> 开发管理 -> 开发设置** 中获取 `AppID` 和 `AppSecret`，用于后端换取 `openid`。

### 6. 钉钉通知集成 (可选)

为了实现辅导员及时通知：
1.  在钉钉群添加 "自定义机器人"。
2.  获取 Webhook 地址。
3.  在后端 `POST /api/questions` 接口成功后，触发 Celery 任务向钉钉发送消息。

## ⚠️ 注意事项

*   **数据安全**: 生产环境中请务必修改数据库密码。
*   **隐私保护**: 只有辅导员账号才有权限查看学生真实身份，请在后端严格控制权限。

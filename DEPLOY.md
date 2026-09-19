# 部署指南（全新服务器）

架构：单容器 Flask + gunicorn（1 进程 6 线程）+ SQLite，微信内容审核在进程内线程异步执行。无独立数据库/队列进程，实测内存 ~200-300MB，1 核 1G 服务器即可。

## 前置条件

- Linux 服务器，已装 Docker 和 docker-compose
- 微信小程序 AppID / AppSecret（小程序后台 → 开发管理 → 开发设置）
- 正式发布：**已备案域名 + HTTPS 证书**（小程序正式版强制校验合法域名；仅开发调试可用 HTTP+IP 并勾选"不校验合法域名"）

## 1. 拉取代码

```bash
git clone https://github.com/MiloMMIN/SecretBox.git
cd SecretBox/server
```

## 2. 配置 config.env

```bash
cp config.env.template config.env
```

| 变量 | 必填 | 说明 |
|------|------|------|
| `WX_APP_ID` / `WX_APP_SECRET` | 是 | 不填则登录走 Mock 模式、内容审核全部跳过 |
| `SECRET_KEY` | 是 | `python -c "import secrets; print(secrets.token_hex(32))"` 生成 |
| `EXTERNAL_URL` | 反代必填 | `https://你的域名`，用于生成图片外链；不配则用请求 Host |
| `SUPER_ADMIN_OPENIDS` | 建议 | 超管 openid，逗号分隔。先留空，按第 6 步回填 |
| `TEACHER_OPENIDS` | 可选 | 预置教师 openid，逗号分隔 |
| `TEACHER_INVITE_CODE` | 可选 | 教师升级邀请码 |
| `DINGTALK_WEBHOOK_URL/SECRET` | 可选 | 钉钉群机器人告警 |
| `MYSQL_*` | 否 | 仅旧 MySQL 数据迁移时作为来源使用 |

## 3. 启动

```bash
docker-compose up -d --build
docker-compose logs -f web        # 看到 "数据库连接成功" / "数据库表创建完成" 即就绪
curl http://127.0.0.1:5000/api/questions   # 健康检查，返回 200 + JSON 列表
```

数据持久化：`server/data/treehole.db`（SQLite，含 WAL 文件）与 `server/uploads/`（图片），均随 `./server` 目录挂载在宿主机，容器重建不丢数据。

## 4. Nginx 反代 + HTTPS（正式环境）

```nginx
server {
    listen 443 ssl;
    server_name your.domain.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    client_max_body_size 10m;   # 与后端 MAX_CONTENT_LENGTH 对齐

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

同时把 `config.env` 的 `EXTERNAL_URL` 改为 `https://your.domain.com` 并 `docker-compose restart`。

> 若 nginx 与后端同机，可把 compose 端口映射改为 `127.0.0.1:5000:5000`，5000 不再对外暴露。

## 5. 微信小程序后台

开发管理 → 开发设置 → 服务器域名，三项都填 `https://your.domain.com`：

- request 合法域名
- uploadFile 合法域名
- downloadFile 合法域名

## 6. 前端改地址并发布

`config.js`：

```js
baseUrl: "https://your.domain.com/api"
```

微信开发者工具重新编译 → 上传 → 提交审核发布。

## 7. 首次登录后回填管理员 openid

超管只能按 openid 配置（openid 登录后才生成）。先用自己的微信登录一次小程序，然后：

```bash
docker-compose exec web python -c \
  "from app import app, User; ctx=app.app_context(); ctx.push(); \
   print([(u.id, u.openid, u.nickname) for u in User.query.all()])"
```

把目标账号的 openid 填入 `config.env` 的 `SUPER_ADMIN_OPENIDS`（教师填 `TEACHER_OPENIDS`），然后 `docker-compose restart`。

## 8. 从旧服务器迁移数据（可选）

- **旧库是 MySQL**：在旧服务仍运行时于本目录执行
  ```bash
  docker-compose exec web python migrate_mysql_to_sqlite.py \
    "mysql+pymysql://root:密码@旧主机:3306/treehole_db"
  ```
- **旧库已是 SQLite**：直接拷贝 `server/data/treehole.db*` 与 `server/uploads/` 到新服务器对应目录即可。

## 9. 日常运维

```bash
# 升级（代码目录挂载进容器，重启即生效；改了 requirements.txt 才需要 --build）
git pull && docker-compose up -d

# 备份（两个目录即全部数据）
tar czf backup-$(date +%F).tar.gz server/data server/uploads

# 日志 / 重启 / 停止
docker-compose logs -f web
docker-compose restart
docker-compose down
```

## 防火墙

安全组/防火墙只需放行 443（及 80 用于证书续期跳转）。调试期直开后端才需要 5000。

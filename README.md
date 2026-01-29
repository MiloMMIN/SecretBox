# 智心树洞 (SecretBox)

智心树洞是一个基于微信小程序的心理咨询与互动平台，旨在为学生提供一个安全、私密或公开的表达空间，并连接辅导员提供专业的心理支持。

## 📖 项目简介

本项目包含微信小程序前端和 Python Flask 后端。主要功能包括：
- **问题广场**：公开提问、浏览热门话题、互动讨论。
- **树洞投递**：向指定辅导员进行私密咨询或投递到公开广场。
- **个人中心**：管理个人信息、查看历史提问与回复、辅导员工作台。

## 🛠️ 技术栈

### 前端 (Mini Program)
- **框架**: 微信小程序原生框架 (WXML, WXSS, JS, JSON)
- **UI风格**: 自定义设计系统 (CSS Variables)，清新绿色主调
- **特性**:
  - 自定义组件与页面容器
  - CSS3 动画与过渡
  - 响应式布局
  - 微信开放能力集成 (头像/昵称获取)

### 后端 (Server)
- **框架**: Python Flask
- **数据库**: MySQL (SQLAlchemy ORM)
- **异步任务**: Celery + Redis
- **部署**: Docker & Docker Compose

## 📂 目录结构

```
SecretBox/
├── pages/                  # 小程序页面目录
│   ├── index/              # 首页/广场页
│   ├── post/               # 投递相关页面 (选导师/创建)
│   ├── square_post/        # 广场专用投稿页
│   └── profile/            # 个人中心页
├── server/                 # 后端代码目录
│   ├── app.py              # Flask 应用入口
│   ├── Dockerfile          # 后端镜像构建
│   ├── docker-compose.yml  # 容器编排
│   └── ...
├── app.js                  # 小程序全局逻辑
├── app.json                # 小程序全局配置
├── app.wxss                # 小程序全局样式
└── project.config.json     # 开发者工具配置
```

## ✨ 核心功能

### 1. 问题广场 (`pages/index`)
- **浏览**: 查看最新的公开提问。
- **排序**: 支持按最新、热度、讨论量排序。
- **搜索**: 关键词搜索感兴趣的话题。
- **互动**: 查看问题详情及辅导员回复。
- **悬浮发布**: 快捷入口发布新问题到广场。

### 2. 提问投递
- **广场投稿** (`pages/square_post`): 
  - 专门的广场提问界面。
  - 支持匿名/实名切换。
  - 字数统计与表单验证。
- **定向咨询** (`pages/post/select_counselor`):
  - 选择特定辅导员进行私密咨询 (功能开发中)。

### 3. 个人中心 (`pages/profile`)
- **用户管理**:
  - 支持微信头像/昵称同步与自定义修改。
  - 角色展示 (学生/辅导员)。
- **学生视图**:
  - 查看“我的提问”列表及状态。
  - 查看“我的回复”历史。
- **辅导员视图** (权限控制):
  - 数据看板 (待回复数、今日留言)。
  - 树洞信箱入口。
  - 数据导出功能。

## 🚀 快速开始

### 前端运行
1. 下载并安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 导入项目目录 `SecretBox`。
3. 修改 `appid` (在 `project.config.json` 中) 为你自己的测试 AppID 或使用测试号。
4. 编译预览。

### 后端运行 (Docker)
1. 进入 `server` 目录。
2. 复制环境变量模板: `cp config.env.template config.env` 并配置数据库信息。
3. 启动服务:
   ```bash
   docker-compose up -d --build
   ```

## 📝 开发规范
- **样式**: 使用 `var(--variable-name)` 调用 `app.wxss` 中定义的全局变量，保持视觉一致性。
- **交互**: 重要的操作需提供 Loading 反馈或 Toast 提示。
- **导航**: TabBar 页面使用 `wx.switchTab`，非 TabBar 页面使用 `wx.navigateTo`。

## 🤝 贡献
欢迎提交 Issue 或 Pull Request 来改进这个树洞！

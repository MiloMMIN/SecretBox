# 使用 Python 3.9 轻量版
FROM python:3.9-slim

# 设置工作目录
WORKDIR /app

# 设置环境变量
# 防止 Python 生成 .pyc 文件
ENV PYTHONDONTWRITEBYTECODE=1
# 防止 Python 缓冲 stdout 和 stderr
ENV PYTHONUNBUFFERED=1

# 安装系统依赖（如果需要编译某些 Python 包）
# RUN apt-get update && apt-get install -y gcc default-libmysqlclient-dev pkg-config && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制项目代码
COPY . /app

# 暴露端口
EXPOSE 5007

# 默认启动命令（会被 docker-compose 覆盖）
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app:app"]

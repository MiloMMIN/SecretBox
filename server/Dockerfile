# 使用 Python 3.11 轻量版
FROM python:3.11-slim

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

# 先升级 pip，再通过国内源安装 Python 依赖，减少构建时超时失败
RUN python -m pip install --no-cache-dir --upgrade pip \
	-i https://pypi.tuna.tsinghua.edu.cn/simple
RUN python -m pip install --no-cache-dir --default-timeout=120 \
	-i https://pypi.tuna.tsinghua.edu.cn/simple \
	-r requirements.txt

# 复制项目代码
COPY . /app

# 暴露端口
EXPOSE 5000

# 默认启动命令（会被 docker-compose 覆盖）
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app:app"]

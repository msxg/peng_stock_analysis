# Node.js 运行环境（不预置代码，通过入口脚本拉取）
FROM node:20-bookworm-slim

# 安装编译工具（better-sqlite3 需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    git \
    curl \
    iproute2 \
    && rm -rf /var/lib/apt/lists/*

# 创建工作目录
WORKDIR /app

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 复制入口脚本
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 暴露端口
EXPOSE 8888 8889

# 容器入口
ENTRYPOINT ["/entrypoint.sh"]
#!/bin/bash
#
# 股票分析系统部署脚本
# 用法: ./deploy.sh {init|start|stop|restart|status|logs|update}
#

set -e

# 配置
CONTAINER_NAME="peng-stock-analysis"
IMAGE_NAME="peng-stock-analysis"
WORK_DIR="/app"
GIT_REPO="https://github.com/msxg/peng_stock_analysis.git"
BRANCH="main"

# 端口配置
FRONTEND_PORT=8888
BACKEND_PORT=8889

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检查容器是否运行
is_running() {
    docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# 在容器内执行命令
exec_in_container() {
    docker exec -w ${WORK_DIR} ${CONTAINER_NAME} bash -c "$1"
}

# 构建镜像
build_image() {
    log_info "构建 Docker 镜像..."
    docker build -t ${IMAGE_NAME} -f docker/Dockerfile docker/
    log_info "镜像构建完成"
}

# 初始化：构建镜像、启动容器、拉取代码、安装依赖
init() {
    log_info "=== 初始化部署 ==="

    # 检查容器是否已存在
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_warn "容器已存在，先移除..."
        docker rm -f ${CONTAINER_NAME} 2>/dev/null || true
    fi

    # 构建镜像
    build_image

    # 启动容器
    log_info "启动容器..."
    docker run -d \
        --name ${CONTAINER_NAME} \
        -p ${FRONTEND_PORT}:8888 \
        -p ${BACKEND_PORT}:8889 \
        -v ${CONTAINER_NAME}-data:${WORK_DIR}/data \
        -v ${CONTAINER_NAME}-tmp:${WORK_DIR}/tmp \
        --restart unless-stopped \
        ${IMAGE_NAME}

    log_info "容器启动成功"

    # 检查代码目录
    if exec_in_container "[ -d '${WORK_DIR}/.git' ]"; then
        log_warn "代码已存在，跳过克隆"
    else
        log_info "拉取代码..."
        exec_in_container "git clone ${GIT_REPO} ${WORK_DIR}"
    fi

    # 安装依赖
    log_info "安装依赖..."
    exec_in_container "npm install"

    # 构建 Next.js
    log_info "构建前端..."
    exec_in_container "npm run build"

    log_info "=== 初始化完成 ==="
    log_info "访问地址: http://localhost:${FRONTEND_PORT}"
    log_info "使用 './deploy.sh start' 启动服务"
}

# 启动服务
start() {
    if ! is_running; then
        log_error "容器未运行，请先执行 init"
        exit 1
    fi

    log_info "启动服务..."

    # 停止已有进程
    exec_in_container "pkill -f 'node src/server.js' 2>/dev/null || true"
    exec_in_container "pkill -f 'next start' 2>/dev/null || true"

    # 启动后端
    exec_in_container "cd ${WORK_DIR} && nohup npm run start:api > logs/api.log 2>&1 &"

    # 等待后端启动
    sleep 2

    # 启动前端
    exec_in_container "cd ${WORK_DIR} && nohup npm run start:web > logs/web.log 2>&1 &"

    log_info "服务启动完成"
    log_info "前端: http://localhost:${FRONTEND_PORT}"
    log_info "后端: http://localhost:${BACKEND_PORT}"
}

# 停止服务
stop() {
    if ! is_running; then
        log_warn "容器未运行"
        return
    fi

    log_info "停止服务..."
    exec_in_container "pkill -f 'node src/server.js' 2>/dev/null || true"
    exec_in_container "pkill -f 'next start' 2>/dev/null || true"
    log_info "服务已停止"
}

# 重启服务
restart() {
    log_info "重启服务..."
    stop
    sleep 2
    start
}

# 查看状态
status() {
    echo "=== 服务状态 ==="

    if ! is_running; then
        log_error "容器未运行"
        exit 1
    fi

    echo "容器: ${CONTAINER_NAME} (运行中)"
    echo ""

    # 检查进程
    echo "进程状态:"
    exec_in_container "ps aux | grep -E '(node src/server|next start)' | grep -v grep || echo '无运行进程'"
    echo ""

    # 端口检查
    echo "端口监听:"
    exec_in_container "ss -tlnp 2>/dev/null | grep -E '8888|8889' || netstat -tlnp 2>/dev/null | grep -E '8888|8889' || echo '端口未监听'"
}

# 查看日志
logs() {
    if ! is_running; then
        log_error "容器未运行"
        exit 1
    fi

    echo "=== API 日志 ==="
    exec_in_container "tail -100 ${WORK_DIR}/logs/api.log 2>/dev/null || echo '无日志'"
    echo ""
    echo "=== Web 日志 ==="
    exec_in_container "tail -100 ${WORK_DIR}/logs/web.log 2>/dev/null || echo '无日志'"
}

# 更新代码
update() {
    if ! is_running; then
        log_error "容器未运行"
        exit 1
    fi

    log_info "更新代码..."
    exec_in_container "cd ${WORK_DIR} && git fetch origin && git reset --hard origin/${BRANCH}"
    exec_in_container "cd ${WORK_DIR} && npm install"
    exec_in_container "cd ${WORK_DIR} && npm run build"
    log_info "代码更新完成，使用 restart 重启服务"
}

# 帮助信息
help() {
    echo "用法: ./deploy.sh <命令>"
    echo ""
    echo "命令:"
    echo "  init      初始化：构建镜像、启动容器、拉取代码、安装依赖"
    echo "  start     启动服务（API + Web）"
    echo "  stop      停止服务"
    echo "  restart   重启服务"
    echo "  status    查看状态"
    echo "  logs      查看日志"
    echo "  update    更新代码并重新构建"
    echo "  build     仅构建 Docker 镜像"
    echo "  help      显示帮助信息"
}

# 主入口
case "$1" in
    init)      init ;;
    start)     start ;;
    stop)      stop ;;
    restart)   restart ;;
    status)    status ;;
    logs)      logs ;;
    update)    update ;;
    build)     build_image ;;
    help|--help|-h) help ;;
    *)
        log_error "未知命令: $1"
        help
        exit 1
    ;;
esac
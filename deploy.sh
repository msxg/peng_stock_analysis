#!/bin/bash
#
# 股票分析系统管理脚本（容器内运行）
# 用法: ./deploy.sh {init|start|stop|restart|status|logs|update}
#

set -e

# 配置
WORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGS_DIR="${WORK_DIR}/logs"
PID_DIR="${WORK_DIR}/logs"

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

# 检查进程是否运行
is_process_running() {
    local pid_file="$1"
    [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

# 等待进程启动
wait_for_port() {
    local port="$1"
    local max_wait=10
    local count=0
    while [ $count -lt $max_wait ]; do
        if ss -tln 2>/dev/null | grep -q ":${port}" || netstat -tln 2>/dev/null | grep -q ":${port}"; then
            return 0
        fi
        sleep 1
        count=$((count + 1))
    done
    return 1
}

# 初始化：检查环境、安装依赖、构建
init() {
    log_info "=== 初始化项目 ==="

    cd "${WORK_DIR}"

    # 创建必要目录
    mkdir -p "${LOGS_DIR}"
    mkdir -p "${WORK_DIR}/data"
    mkdir -p "${WORK_DIR}/tmp"

    # 检查 .env 文件
    if [ ! -f "${WORK_DIR}/.env" ]; then
        log_warn ".env 文件不存在，从示例复制..."
        cp "${WORK_DIR}/.env.example" "${WORK_DIR}/.env"
        log_warn "请编辑 .env 文件配置必要参数"
    fi

    # 检查 node_modules
    if [ ! -d "${WORK_DIR}/node_modules" ]; then
        log_info "安装依赖..."
        npm install
    else
        log_info "依赖已存在，检查更新..."
        npm install --prefer-offline
    fi

    # 检查构建产物
    if [ ! -d "${WORK_DIR}/.next" ] || [ ! -f "${WORK_DIR}/.next/BUILD_ID" ]; then
        log_info "构建前端..."
        npm run build
    else
        log_info "构建产物已存在"
    fi

    log_info "=== 初始化完成 ==="
    log_info "使用 './deploy.sh start' 启动服务"
}

# 启动服务
start() {
    cd "${WORK_DIR}"

    # 确保 logs 目录存在
    mkdir -p "${LOGS_DIR}"

    # 检查是否需要初始化
    if [ ! -d "${WORK_DIR}/node_modules" ] || [ ! -d "${WORK_DIR}/.next" ]; then
        log_warn "项目未初始化，先执行初始化..."
        init
    fi

    log_info "启动服务..."

    # 检查后端是否已运行
    if is_process_running "${PID_DIR}/api.pid"; then
        log_warn "后端已运行 (PID: $(cat ${PID_DIR}/api.pid))"
    else
        log_info "启动后端..."
        nohup npm run start:api > "${LOGS_DIR}/api.log" 2>&1 &
        echo $! > "${PID_DIR}/api.pid"

        if wait_for_port ${BACKEND_PORT}; then
            log_info "后端启动成功 (PID: $(cat ${PID_DIR}/api.pid), 端口: ${BACKEND_PORT})"
        else
            log_error "后端启动失败，查看日志: ${LOGS_DIR}/api.log"
            exit 1
        fi
    fi

    # 检查前端是否已运行
    if is_process_running "${PID_DIR}/web.pid"; then
        log_warn "前端已运行 (PID: $(cat ${PID_DIR}/web.pid))"
    else
        log_info "启动前端..."
        nohup npm run start:web > "${LOGS_DIR}/web.log" 2>&1 &
        echo $! > "${PID_DIR}/web.pid"

        if wait_for_port ${FRONTEND_PORT}; then
            log_info "前端启动成功 (PID: $(cat ${PID_DIR}/web.pid), 端口: ${FRONTEND_PORT})"
        else
            log_error "前端启动失败，查看日志: ${LOGS_DIR}/web.log"
            exit 1
        fi
    fi

    log_info "=== 服务已启动 ==="
    log_info "前端: http://localhost:${FRONTEND_PORT}"
    log_info "后端: http://localhost:${BACKEND_PORT}"
}

# 停止服务
stop() {
    log_info "停止服务..."

    # 停止前端
    if is_process_running "${PID_DIR}/web.pid"; then
        local web_pid=$(cat "${PID_DIR}/web.pid")
        log_info "停止前端 (PID: ${web_pid})..."
        kill ${web_pid} 2>/dev/null || true
        rm -f "${PID_DIR}/web.pid"
    else
        log_warn "前端未运行"
    fi

    # 停止后端
    if is_process_running "${PID_DIR}/api.pid"; then
        local api_pid=$(cat "${PID_DIR}/api.pid")
        log_info "停止后端 (PID: ${api_pid})..."
        kill ${api_pid} 2>/dev/null || true
        rm -f "${PID_DIR}/api.pid"
    else
        log_warn "后端未运行"
    fi

    # 清理残留进程
    pkill -f "next start" 2>/dev/null || true
    pkill -f "node src/server.js" 2>/dev/null || true

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

    # 后端状态
    if is_process_running "${PID_DIR}/api.pid"; then
        echo "后端: 运行中 (PID: $(cat ${PID_DIR}/api.pid))"
    else
        echo "后端: 未运行"
    fi

    # 前端状态
    if is_process_running "${PID_DIR}/web.pid"; then
        echo "前端: 运行中 (PID: $(cat ${PID_DIR}/web.pid))"
    else
        echo "前端: 未运行"
    fi

    echo ""
    echo "端口监听:"
    ss -tln 2>/dev/null | grep -E '8888|8889' || netstat -tln 2>/dev/null | grep -E '8888|8889' || echo "无端口监听"
}

# 查看日志
logs() {
    local service="$2"

    if [ "$service" = "api" ]; then
        tail -100 "${LOGS_DIR}/api.log" 2>/dev/null || echo "无 API 日志"
    elif [ "$service" = "web" ]; then
        tail -100 "${LOGS_DIR}/web.log" 2>/dev/null || echo "无 Web 日志"
    else
        echo "=== API 日志 ==="
        tail -50 "${LOGS_DIR}/api.log" 2>/dev/null || echo "无日志"
        echo ""
        echo "=== Web 日志 ==="
        tail -50 "${LOGS_DIR}/web.log" 2>/dev/null || echo "无日志"
    fi
}

# 更新代码
update() {
    log_info "更新代码..."
    cd "${WORK_DIR}"

    # 获取当前分支
    local branch=$(git rev-parse --abbrev-ref HEAD)

    # 拉取最新代码
    git fetch origin
    git reset --hard origin/${branch}

    # 重新安装依赖
    npm install

    # 重新构建
    npm run build

    log_info "代码更新完成"
    log_info "使用 './deploy.sh restart' 重启服务"
}

# 帮助信息
help() {
    echo "用法: ./deploy.sh <命令>"
    echo ""
    echo "命令:"
    echo "  init       初始化项目（安装依赖、构建、创建目录）"
    echo "  start      启动服务（自动检测是否需要初始化）"
    echo "  stop       停止服务"
    echo "  restart    重启服务"
    echo "  status     查看服务状态"
    echo "  logs       查看日志（可指定 api 或 web）"
    echo "  update     更新代码并重新构建"
    echo "  help       显示帮助信息"
}

# 主入口
case "$1" in
    init)      init ;;
    start)     start ;;
    stop)      stop ;;
    restart)   restart ;;
    status)    status ;;
    logs)      logs "$@" ;;
    update)    update ;;
    help|--help|-h) help ;;
    *)
        log_error "未知命令: $1"
        help
        exit 1
    ;;
esac
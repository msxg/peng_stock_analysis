#!/bin/bash
#
# 容器入口脚本：负责拉取代码并执行项目管理脚本
#

set -e

WORK_DIR="/app"
GIT_REPO="${GIT_REPO:-https://github.com/msxg/peng_stock_analysis.git}"
BRANCH="${BRANCH:-main}"

echo "=== 容器入口脚本 ==="

# 检查代码是否存在
if [ ! -d "${WORK_DIR}/.git" ]; then
    echo "[INFO] 拉取代码..."
    rm -rf ${WORK_DIR}/*
    git clone ${GIT_REPO} ${WORK_DIR}
fi

cd ${WORK_DIR}

# 如果传入命令，执行项目内的 deploy.sh
if [ $# -gt 0 ]; then
    ./deploy.sh "$@"
else
    # 无命令时保持容器运行
    echo "[INFO] 容器已就绪，使用 './deploy.sh <命令>' 管理服务"
    tail -f /dev/null
fi
#!/bin/bash

# 启动脚本 - 同时启动前端和后端服务

echo "=== Easy Reader 启动脚本 ==="
echo "正在启动前端和后端服务..."

# 启动后端服务
echo "启动后端服务..."
cd backend
python3 app.py &
BACKEND_PID=$!
echo "后端服务已启动，PID: $BACKEND_PID"

# 等待后端服务启动
sleep 3

# 启动前端服务
echo "启动前端服务..."
cd ../frontend
npm run dev &
FRONTEND_PID=$!
echo "前端服务已启动，PID: $FRONTEND_PID"

echo "=== 服务启动完成 ==="
echo "前端服务地址: http://localhost:5174"
echo "后端服务地址: http://localhost:5001"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 等待用户输入
trap "kill $BACKEND_PID $FRONTEND_PID; echo '服务已停止'; exit 0" SIGINT

while true; do
    sleep 1
done
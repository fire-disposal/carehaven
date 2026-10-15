#!/bin/sh
# 容器入口：先应用迁移（幂等），再启动服务。
# 迁移失败即退出 → 由 compose 重启策略与 CI 健康检查兜底（不会带着坏状态对外服务）。
set -eu

PB_DIR="${PB_DIR:-/pb/pb_data}"
PB_MIGRATIONS_DIR="${PB_MIGRATIONS_DIR:-/pb/pb_migrations}"
PB_HOOKS_DIR="${PB_HOOKS_DIR:-/pb/pb_hooks}"
PB_PUBLIC_DIR="${PB_PUBLIC_DIR:-/pb/pb_public}"
PB_HTTP="${PB_HTTP:-0.0.0.0:8090}"
# 容器内无法热改 hooks，关闭文件监听；并调小 goja 运行时池（默认 15 对单机原型偏大）
PB_HOOKS_POOL="${PB_HOOKS_POOL:-5}"

echo "[entrypoint] applying migrations ..."
pocketbase migrate up \
  --dir "$PB_DIR" \
  --migrationsDir "$PB_MIGRATIONS_DIR" \
  --hooksDir "$PB_HOOKS_DIR" \
  --hooksWatch=false \
  --hooksPool="$PB_HOOKS_POOL"

echo "[entrypoint] starting server on $PB_HTTP ..."
exec pocketbase serve \
  --http="$PB_HTTP" \
  --dir "$PB_DIR" \
  --migrationsDir "$PB_MIGRATIONS_DIR" \
  --hooksDir "$PB_HOOKS_DIR" \
  --publicDir "$PB_PUBLIC_DIR" \
  --hooksWatch=false \
  --hooksPool="$PB_HOOKS_POOL" \
  --indexFallback

#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 服务器端一次部署：备份 → 切换镜像 → 健康检查 → 失败自动回滚
#
# 用法（在服务器上，由 CI 通过 ssh 调用）：
#   IMAGE=ghcr.io/owner/repo:sha-abc12345 bash deploy.sh
#
# 设计要点：
#   - 幂等：同一镜像重复执行不会产生副作用（compose 判定无变化即不动容器）
#   - 失败不静默：健康检查不过就回滚到上一个镜像并返回非零
#   - 备份走 PocketBase 管理 API（v0.40 没有 backup 子命令），需要 .env 里的超级用户口令；
#     未配置且 REQUIRE_BACKUP=1 时直接失败，不带着「没备份」的风险上线
# ---------------------------------------------------------------------------
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/carehaven}"
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
ENV_FILE="$APP_DIR/.env"
CONTAINER="${CONTAINER:-carehaven}"
VOLUME="${VOLUME:-carehaven_data}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8090}"
IMAGE="${IMAGE:?需要 IMAGE 环境变量（例如 ghcr.io/owner/repo:sha-abc12345）}"
HEALTH_RETRIES="${HEALTH_RETRIES:-24}" # 24 × 5s = 最多等 2 分钟
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
REQUIRE_BACKUP="${REQUIRE_BACKUP:-0}"

log() { printf '[deploy] %s\n' "$*"; }
warn() { printf '[deploy] ⚠️  %s\n' "$*" >&2; }
die() {
  printf '[deploy] ✖ %s\n' "$*" >&2
  exit 1
}

cd "$APP_DIR"
[ -f "$COMPOSE_FILE" ] || die "找不到 $COMPOSE_FILE"

# ---------- 0. 记录当前镜像，供回滚使用 ----------
PREV_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)"
log "当前镜像：${PREV_IMAGE:-（无，首次部署）}"
log "目标镜像：$IMAGE"

# ---------- 1. 数据卷必须存在 ----------
# 缺卷时 docker 会默默新建一个空卷，看起来部署成功、数据却「消失」了
docker volume inspect "$VOLUME" >/dev/null 2>&1 \
  || die "数据卷 $VOLUME 不存在。首次部署请显式创建：docker volume create $VOLUME"

# ---------- 2. 部署前备份 ----------
backup_name="predeploy-$(date +%Y%m%d-%H%M%S).zip"
HAD_RUNNING=0
docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" && HAD_RUNNING=1

if [ "$HAD_RUNNING" = "1" ] && [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  if [ -n "${SUPERUSER_EMAIL:-}" ] && [ -n "${SUPERUSER_PASSWORD:-}" ]; then
    log "触发部署前备份：$backup_name"
    token="$(curl -fsS -X POST "$BASE_URL/api/collections/_superusers/auth-with-password" \
      -H 'Content-Type: application/json' \
      -d "{\"identity\":\"$SUPERUSER_EMAIL\",\"password\":\"$SUPERUSER_PASSWORD\"}" \
      | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
    if [ -n "$token" ] \
      && curl -fsS -X POST "$BASE_URL/api/backups" \
        -H "Authorization: $token" -H 'Content-Type: application/json' \
        -d "{\"name\":\"$backup_name\"}" >/dev/null \
      && curl -fsS "$BASE_URL/api/backups" -H "Authorization: $token" | grep -q "$backup_name"; then
      log "备份完成：$backup_name"
    else
      [ "$REQUIRE_BACKUP" = "1" ] && die "备份失败（REQUIRE_BACKUP=1 要求必须成功）"
      warn "备份失败，继续部署（如需强制，请设 REQUIRE_BACKUP=1）"
    fi
  else
    [ "$REQUIRE_BACKUP" = "1" ] && die "$ENV_FILE 缺少 SUPERUSER_EMAIL / SUPERUSER_PASSWORD，无法备份"
    warn "$ENV_FILE 未配置超级用户口令，跳过部署前备份"
  fi
elif [ "$HAD_RUNNING" = "0" ]; then
  # 首次部署：没有旧容器可备份，属正常跳过（REQUIRE_BACKUP 不应拦这一种）
  log "未发现运行中的容器（首次部署），跳过部署前备份"
else
  [ "$REQUIRE_BACKUP" = "1" ] && die "容器在运行但缺少 $ENV_FILE，无法备份"
  warn "缺少 $ENV_FILE，跳过部署前备份"
fi

# ---------- 3. 切换镜像并启动 ----------
log "拉取镜像 ..."
docker pull "$IMAGE"
sed -i "s|^\(\s*image:\s*\).*|\1$IMAGE|" "$COMPOSE_FILE"

log "启动容器 ..."
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

# ---------- 4. 健康检查 ----------
healthy=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"
  case "$status" in
    healthy)
      healthy=1
      log "健康检查通过（第 ${i} 次）"
      break
      ;;
    unhealthy)
      warn "容器报告 unhealthy"
      docker logs --tail 40 "$CONTAINER" >&2 || true
      break
      ;;
    missing)
      warn "容器不存在，可能启动即退出"
      docker compose -f "$COMPOSE_FILE" logs --tail 40 >&2 || true
      break
      ;;
    *)
      sleep "$HEALTH_INTERVAL"
      ;;
  esac
done

# ---------- 5. 失败回滚 ----------
if [ "$healthy" != "1" ]; then
  if [ -z "$PREV_IMAGE" ] || [ "$PREV_IMAGE" = "$IMAGE" ]; then
    die "健康检查未通过，且没有可回滚的上一版本"
  fi
  warn "健康检查未通过，回滚到 $PREV_IMAGE"
  sed -i "s|^\(\s*image:\s*\).*|\1$PREV_IMAGE|" "$COMPOSE_FILE"
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
  for _ in $(seq 1 "$HEALTH_RETRIES"); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)" = "healthy" ] && break
    sleep "$HEALTH_INTERVAL"
  done
  die "已回滚到 $PREV_IMAGE，本次发布失败"
fi

# ---------- 6. 记录成功版本 + 清理旧镜像 ----------
printf '%s\n' "$IMAGE" >"$APP_DIR/last_successful_version.txt"
log "已记录成功版本到 last_successful_version.txt"

# 只清理 14 天前的悬空/未使用镜像，避免磁盘被历史构建堆满
docker image prune -af --filter 'until=336h' >/dev/null 2>&1 || true

log "部署完成：$IMAGE"

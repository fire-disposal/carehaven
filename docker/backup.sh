#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 计划备份：由宿主机 cron / systemd timer 调用（例如每天 03:15）
#
# 为什么放宿主机而不是容器内：备份要能独立于应用生命周期运行，
# 且需要把备份文件搬出容器（导出到宿主机或对象存储），否则卷损坏时一起丢。
#
# 用法：
#   15 3 * * * cd /opt/carehaven && bash docker/backup.sh >> /var/log/carehaven-backup.log 2>&1
#
# .env 中需要的键：
#   SUPERUSER_EMAIL / SUPERUSER_PASSWORD   用于调用管理 API 触发备份
#   BACKUP_DEST                            可选，备份导出目录（默认 /opt/carehaven/backups）
# ---------------------------------------------------------------------------
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/carehaven}"
ENV_FILE="$APP_DIR/.env"
CONTAINER="${CONTAINER:-carehaven}"
# 宿主端口为 8200（8090 已被同机其他服务占用）—— 必须与 compose 的端口映射一致
BASE_URL="${BASE_URL:-http://127.0.0.1:8200}"
KEEP_DAYS="${KEEP_DAYS:-14}"

log() { printf '[backup] %s\n' "$*"; }

cd "$APP_DIR"
[ -f "$ENV_FILE" ] || {
  printf '[backup] ✖ 缺少 %s（需 SUPERUSER_EMAIL / SUPERUSER_PASSWORD）\n' "$ENV_FILE" >&2
  exit 1
}

# shellcheck disable=SC1090
. "$ENV_FILE"
: "${SUPERUSER_EMAIL:?缺少 SUPERUSER_EMAIL}"
: "${SUPERUSER_PASSWORD:?缺少 SUPERUSER_PASSWORD}"
BACKUP_DEST="${BACKUP_DEST:-$APP_DIR/backups}"

docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" || {
  printf '[backup] ✖ 容器 %s 未运行\n' "$CONTAINER" >&2
  exit 1
}

name="auto-$(date +%Y%m%d-%H%M%S).zip"
token="$(curl -fsS -X POST "$BASE_URL/api/collections/_superusers/auth-with-password" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$SUPERUSER_EMAIL\",\"password\":\"$SUPERUSER_PASSWORD\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
[ -n "$token" ] || {
  printf '[backup] ✖ 获取管理 token 失败\n' >&2
  exit 1
}

curl -fsS -X POST "$BASE_URL/api/backups" \
  -H "Authorization: $token" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$name\"}" >/dev/null
curl -fsS "$BASE_URL/api/backups" -H "Authorization: $token" | grep -q "$name" || {
  printf '[backup] ✖ 备份未出现在列表中：%s\n' "$name" >&2
  exit 1
}
log "备份已创建：$name"

# 导出到宿主机（卷损坏时的唯一救命绳）
mkdir -p "$BACKUP_DEST"
docker cp "$CONTAINER:/pb/pb_data/backups/$name" "$BACKUP_DEST/$name"
log "已导出到 $BACKUP_DEST/$name"

# 清理过期备份（容器内 + 宿主机）
find "$BACKUP_DEST" -name '*.zip' -mtime "+$KEEP_DAYS" -delete
docker exec "$CONTAINER" sh -c "find /pb/pb_data/backups -name '*.zip' -mtime +$KEEP_DAYS -delete" || true
log "已清理 $KEEP_DAYS 天前的备份"

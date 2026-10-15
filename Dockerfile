# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# 智护忆站 —— 单容器镜像
#   阶段 1：构建 H5 前端（产物随镜像分发，部署即原子切换）
#   阶段 2：运行时：Alpine + PocketBase 二进制 + 迁移 + hooks + 前端产物
# 资源占用：镜像约 60MB，常驻内存约 50MB（见 compose 中的上限设置）
# ---------------------------------------------------------------------------

# ---------- 阶段 1：前端 H5 ----------
# 必须用 glibc 基础镜像：Taro 的原生绑定按平台分发（linux-x64-gnu / -musl），
# Alpine(musl) 下 bun install 拿不到对应二进制，构建会报
# "Cannot find module '@tarojs/binding-linux-x64-musl'"
FROM oven/bun:1 AS web

WORKDIR /web
COPY miniapp/package.json miniapp/bun.lock ./
RUN bun install --frozen-lockfile

COPY miniapp/ ./
RUN bun run build:h5

# ---------- 阶段 2：运行时 ----------
FROM alpine:3.21

# PocketBase 版本与校验和固定，保证构建可复现（校验和来自官方 release 资产）
ARG PB_VERSION=0.40.5
ARG PB_SHA256=1dbea1b01eb3dfe64953513859d01e759c96650c4e3264fa4eecd54b769382e4

RUN apk add --no-cache ca-certificates tzdata unzip \
    && wget -qO /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" \
    && echo "${PB_SHA256}  /tmp/pb.zip" | sha256sum -c - \
    && unzip -o -q /tmp/pb.zip pocketbase -d /usr/local/bin \
    && chmod +x /usr/local/bin/pocketbase \
    && rm -f /tmp/pb.zip \
    && adduser -D -u 10001 -h /pb pb

ENV TZ=Asia/Shanghai

WORKDIR /pb
COPY pb_migrations ./pb_migrations
COPY pb_hooks ./pb_hooks
COPY --from=web /web/dist ./pb_public
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /pb/pb_data \
    && chown -R pb:pb /pb

# 非 root 运行
USER pb

EXPOSE 8090
VOLUME ["/pb/pb_data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

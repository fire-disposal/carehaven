# 部署到 app-host（Docker + GitHub CI/CD）

目标服务器：app-host（2 vCPU / 3.8G 内存，已运行其他 Docker 服务）。
本系统**单容器**：PocketBase 自带 SQLite，前端 H5 产物打进同一个镜像 → 常驻内存约 50MB，镜像约 60MB。

> 为什么可以单容器：PB 把数据库、鉴权、定时任务、静态托管都做在一个进程里，
> 没有 PG / Redis / Celery 需要编排。**唯一纪律：不要起多副本**（进程内定时任务会重复执行）。

---

## 一、架构

```
微信小程序 ─┐
           ├─► HTTPS 域名 ─► Caddy/Nginx（宿主机） ─► 127.0.0.1:8090 ─► 容器 carehaven
浏览器 H5 ─┘                                                          └─ 命名卷 carehaven_data
                                                                          （SQLite + 上传文件 + 备份）
```

小程序端与 H5 端**共用同一份数据与账号体系**：同一账号在两端登录看到同一份数据。

---

## 二、首次部署（只做一次）

### 1. 服务器准备

```bash
ssh app-host 'mkdir -p /opt/carehaven'
ssh app-host 'docker volume create carehaven_data'   # 显式建卷：脚本会检查它存在，避免误建空卷

# 备份用口令（仅服务器上保存，绝不进 CI 或 git）
ssh app-host 'cat > /opt/carehaven/.env <<EOF
SUPERUSER_EMAIL=admin@your.domain
SUPERUSER_PASSWORD=改成强密码
EOF
chmod 600 /opt/carehaven/.env'
```

### 2. CI 需要的仓库 Secrets

| Secret | 说明 |
|---|---|
| `SERVER_HOST` | 服务器地址 |
| `SERVER_USER` | SSH 用户 |
| `SERVER_SSH_KEY` | 部署私钥 |

（`GITHUB_TOKEN` 由 Actions 自动注入，用于推送镜像到 GHCR。）

首次构建后到 GitHub 仓库 → Packages → 该镜像 → Package settings，
把可见性设为 **Private**（默认继承仓库可见性，私有仓库无需改动）。

### 3. 第一次上线

推送到 `main` 触发构建，然后在 Actions 页面手动 **Run workflow**（勾选 deploy）。
脚本会自动：备份（首次无运行容器则跳过）→ 切换镜像 → 健康检查 → 失败回滚。

### 4. 反向代理（HTTPS 必需，小程序请求强制 HTTPS）

宿主机 Caddy：

```
api.example.com {
    reverse_proxy 127.0.0.1:8090
}
```

注意 `/api/` 与 `/_/`（管理后台）都在同一端口下，无需额外配置；管理后台建议加 IP 白名单或改为仅内网访问。

---

## 三、日常发版

```
推送代码 → main（自动构建镜像，不部署）
Actions → Run workflow → deploy=true（自动备份 + 切换 + 健康检查 + 回滚）
```

构建只在相关路径变化时触发（`pb_migrations/`、`pb_hooks/`、`miniapp/`、`docker/`、`Dockerfile`、compose），
改文档不会浪费 Actions 额度。

### 部署脚本做了什么

1. 记录当前镜像（供回滚）
2. 检查数据卷存在（防止静默新建空卷）
3. 调管理 API 做部署前备份，并核对备份出现在列表中
4. `docker pull` → 改写 compose 的 image 行 → `docker compose up -d`
5. 轮询容器健康状态（最多 2 分钟）
6. 失败 → 写回旧镜像并 `up -d`，返回非零；成功 → 记录 `last_successful_version.txt`
7. 清理 14 天前的旧镜像

强制要求备份必成功：在服务器上设 `REQUIRE_BACKUP=1`。

---

## 四、备份

部署前备份是自动的；**日常备份**由宿主机 cron 调脚本（备份导出到宿主机，并用 `KEEP_DAYS` 轮转）：

```bash
ssh app-host 'crontab -l 2>/dev/null; echo "15 3 * * * cd /opt/carehaven && bash backup.sh >> /var/log/carehaven-backup.log 2>&1" | crontab -'
```

（首次需把 `docker/backup.sh` 上传到 `/opt/carehaven/`；CI 部署时会一并上传。）

恢复：

```bash
# 列出备份
curl -s http://127.0.0.1:8090/api/backups -H "Authorization: <superuser token>"
# 在管理后台「Settings → Backups」点击恢复最直观
```

**不要**在运行中直接 `cp` SQLite 主库文件，一律走管理 API 的备份。

---

## 五、定时任务

PocketBase 的 cron 是**进程内**的：只做定时触发，**停机错过的时间点不会补跑**。
若推送必须发出，用 systemd timer 调一次 HTTP（`Persistent=true` 提供补跑），
或采用本项目建议的思路：把「该不该发」写成数据状态，定时器只负责扫描到期未发。

---

## 六、回滚

```bash
# 查看上次成功版本
ssh app-host 'cat /opt/carehaven/last_successful_version.txt'

# 回滚到指定 tag（脚本会再走一遍健康检查）
ssh app-host 'cd /opt/carehaven && IMAGE=ghcr.io/<owner>/<repo>:sha-<8位> bash deploy.sh'
```

数据回滚：在管理后台用备份恢复；恢复前先停容器。

---

## 七、上线前检查清单

- [ ] 管理后台强密码，且 `/_/` 未对公网开放（或加白名单）
- [ ] `app_config` 的 HPS 权重与阈值经指导老师/专家确认
- [ ] 模拟数据与真实数据在展示与材料中均已区分标注
- [ ] UGC 审核能力完成前，保持不开放注册（见 README「合规与上线风险」）
- [ ] 隐私政策与知情同意流程就绪
- [ ] 备份恢复演练过一次
- [ ] 容器资源上限（256MB / 1 CPU）在真实负载下复核

---

## 附：不用 Docker 的裸二进制方式

服务器没有 Docker 时，也 `rsync` 二进制 + `pb_migrations` + `pb_hooks` + `pb_public`，
用 systemd 常驻，流程与上面的容器方案等价，只是少了镜像原子切换与自动回滚。

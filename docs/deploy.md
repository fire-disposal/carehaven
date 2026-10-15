# 部署记录与运维手册（CareHaven / 智护忆站）

本文前半是**已落地的事实记录**（便于日后追溯与续期检查），后半是运维手册。

---

## 一、已落地的事实（2026-10-15）

| 项 | 值 |
|---|---|
| 服务器 | 境内 VPS `203.0.113.10`（2 vCPU / 3.8G），SSH 别名 `app-host` |
| 域名 | `https://care.example.com` |
| DNS | Cloudflare A 记录 `care` → `203.0.113.10`，**DNS-only（灰云）**，注释「智护忆站 原型（PB+Taro）」 |
| 站点配置 | `/etc/nginx/sites-available/care.example.com.conf`（`sites-enabled/` 同名软链） |
| 证书 | `/etc/letsencrypt/live/care.example.com/`（Let's Encrypt / webroot `/var/www/html` / ecdsa，随 `certbot.timer` 自动续期） |
| 应用端口 | **`127.0.0.1:8200`（仅回环）**；宿主 `8080`/`8090` 已被同机其他服务占用，故避开 |
| 部署目录 | `/srv/carehaven/`（`.env` 600 root，内含备份用超级用户口令） |
| 数据卷 | `carehaven_data` → `/pb/pb_data`（SQLite + 上传 + 备份） |
| 容器名 | `carehaven` |
| 仓库 | https://github.com/fire-disposal/carehaven（private） |
| CI/CD | `.github/workflows/build-and-deploy.yml`；secrets：`SSH_HOST`/`SSH_USER`/`SSH_PRIVATE_KEY`（私钥为本机 `~/.ssh/deploy_key`） |
| 镜像 | `ghcr.io/fire-disposal/carehaven:sha-<8位>`（服务器 `/root/.docker/config.json` 已有 GHCR 凭据，**勿用 `latest`**，历史经验是 `latest` 可能 `denied`） |
| 上游未就绪 | nginx 返回 **503 施工中**（`error_page 502 504 = @maintenance`），不裸奔 502 |

### 已验证的边界

- 同机其他站点未受影响（均已逐一验证，不在此列出）
- `sp.example.com` 返回 000 为**既有状态**（其上游未运行），与本次变更无关；本次仅新增本项目域名的两个文件
  （`/etc/nginx` 下当日改动仅 `care.example.com.conf`）

---

## 二、架构

```
微信小程序 ─┐
           ├─► https://care.example.com ─► nginx :443 ─► 127.0.0.1:8200 ─► 容器 carehaven
浏览器 H5 ─┘                                                          └─ 卷 carehaven_data
```

- **H5 与小程序共用同一份数据与账号**：同一账号在两端登录看到同一份数据（后端只有一套 PB + SQLite）
- API 与 H5 **同源**，因此**不需要 CORS 配置**；小程序请求不受 CORS 约束
- ⚠️ 不要起多副本：PocketBase 的定时任务是进程内的，多副本会重复执行

---

## 三、日常发版

```
推送 main            → 自动构建镜像推 GHCR（不部署）
Actions → Run workflow → 自动部署
```

部署脚本 `docker/deploy.sh` 的动作顺序：

1. 记录当前镜像（供回滚）
2. 检查数据卷存在（防止静默新建空卷）
3. 调管理 API 做部署前备份并核对备份出现在列表中（`REQUIRE_BACKUP=1` 时失败即中止；**首次部署无旧容器时按正常跳过**）
4. `docker pull` → 改写 compose 的 image 行 → `docker compose up -d`
5. 轮询容器健康状态（最多 2 分钟）
6. 失败 → 写回旧镜像 `up -d` 并返回非零；成功 → 记 `last_successful_version.txt`
7. 清理 14 天前的旧镜像

---

## 四、首次部署（已完成，留档备重建）

```bash
ssh app-host 'mkdir -p /srv/carehaven'
ssh app-host 'docker volume create carehaven_data'
ssh app-host 'printf "SUPERUSER_EMAIL=admin@care.example.com\nSUPERUSER_PASSWORD=<强口令>\n" > /srv/carehaven/.env && chmod 600 /srv/carehaven/.env'
```

`.env` 里的超级用户口令用于备份与后台登录，**口令在服务器本地生成、不进 git**。
容器起来之后创建同口令的超级用户：

```bash
ssh app-host 'set -a; . /srv/carehaven/.env; set +a; \
  docker exec carehaven /usr/local/bin/pocketbase superuser create "$SUPERUSER_EMAIL" "$SUPERUSER_PASSWORD" --dir /pb/pb_data'
```

---

## 五、备份

- **部署前备份**：由 `deploy.sh` 自动完成
- **日常备份**：宿主机 cron 调 `docker/backup.sh`（会把备份导出到宿主机，卷损坏时仍能恢复）

```bash
ssh app-host 'echo "15 3 * * * cd /srv/carehaven && bash backup.sh >> /var/log/carehaven-backup.log 2>&1" | crontab -'
```

恢复：管理后台 `/_/` → Settings → Backups 点恢复最直观（**不要在运行中直接 cp SQLite 主库文件**）。

---

## 六、回滚

```bash
ssh app-host 'cat /srv/carehaven/last_successful_version.txt'                    # 上次成功版本
ssh app-host 'cd /srv/carehaven && IMAGE=ghcr.io/fire-disposal/carehaven:sha-<8位> bash deploy.sh'
```

---

## 七、定时任务

PocketBase 内置 cron 是**进程内**的：只做定时触发，**停机错过的时间点不会补跑**。
若推送必须发出，用 systemd timer（`Persistent=true` 有补跑）或把「该不该发」写成数据状态、
由定时器扫描到期未发（本项目建议的思路）。

---

## 八、上线前检查清单

- [ ] 管理后台强密码，且 `/_/` 不对公网开放（或加 IP 白名单）
- [ ] `app_config` 的 HPS 权重与阈值经指导老师/专家确认
- [ ] 模拟数据与真实数据在展示与材料中均已区分标注
- [ ] UGC 审核能力完成前，保持不开放注册（见 README「合规与上线风险」）
- [ ] 域名 ICP 备案（小程序上线必需；微信侧也要完成小程序备案）
- [ ] 备份恢复演练过一次
- [ ] 容器资源上限（256MB / 1 CPU）在真实负载下复核

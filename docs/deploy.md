# 部署记录与运维手册（CareHaven / 智护忆站）

本文前半是**已落地的事实记录**（便于日后追溯与续期检查），后半是运维手册。

> 具体主机地址、生产域名、SSH 别名与私钥路径属于基础设施信息，**不随仓库公开**；
> 下文以占位符表示（`<SERVER_IP>`、`<PROD_DOMAIN>`、`<SSH_ALIAS>`、`<SERVER_OPS_DIR>`），实际值仅保留在本机未跟踪文件与服务器上。

---

## 一、已落地的事实（2026-10-15）

| 项 | 值 |
|---|---|
| 服务器 | 境内 VPS `<SERVER_IP>`（2 vCPU / 3.8G），SSH 别名 `<SSH_ALIAS>` |
| 域名 | `https://<PROD_DOMAIN>` |
| DNS | Cloudflare A 记录 → `<SERVER_IP>`，**DNS-only（灰云）**，注释「智护忆站 原型（PB+Taro）」 |
| 站点配置 | `/etc/nginx/sites-available/<PROD_DOMAIN>.conf`（`sites-enabled/` 同名软链） |
| 证书 | `/etc/letsencrypt/live/<PROD_DOMAIN>/`（Let's Encrypt / webroot `/var/www/html` / ecdsa，随 `certbot.timer` 自动续期） |
| 应用端口 | **`127.0.0.1:8200`（仅回环）**；宿主 `8080`/`8090` 已被同机其他服务占用，故避开 |
| 部署目录 | `/srv/carehaven/`（`.env` 600 root，内含备份用超级用户口令） |
| 数据卷 | `carehaven_data` → `/pb/pb_data`（SQLite + 上传 + 备份） |
| 容器名 | `carehaven` |
| 仓库 | https://github.com/fire-disposal/carehaven |
| CI/CD | `.github/workflows/build-and-deploy.yml`；secrets：`SSH_HOST`/`SSH_USER`/`SSH_PRIVATE_KEY`（私钥保存在本机，不进仓库） |
| 镜像 | `ghcr.io/fire-disposal/carehaven:sha-<8位>`（服务器 `/root/.docker/config.json` 已有 GHCR 凭据，**勿用 `latest`**，历史经验是 `latest` 可能 `denied`） |
| 上游未就绪 | nginx 返回 **503 施工中**（`error_page 502 504 = @maintenance`），不裸奔 502 |

### 已验证的边界

- 同机其他站点未受影响（均已逐一验证，不在此列出）
- `sp.example.com` 返回 000 为**既有状态**（其上游未运行），与本次变更无关；本次仅新增本项目域名的两个文件
  （`/etc/nginx` 下当日改动仅 `<PROD_DOMAIN>.conf`）

---

## 二、架构

```
微信小程序 ─┐
           ├─► https://<PROD_DOMAIN> ─► nginx :443 ─► 127.0.0.1:8200 ─► 容器 carehaven
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
ssh <SSH_ALIAS> 'mkdir -p /srv/carehaven'
ssh <SSH_ALIAS> 'docker volume create carehaven_data'
ssh <SSH_ALIAS> 'printf "SUPERUSER_EMAIL=admin@<PROD_DOMAIN>\nSUPERUSER_PASSWORD=<强口令>\nWECHAT_APP_ID=\nWECHAT_APP_SECRET=\nVOLC_TTS_API_KEY=\nVOLC_TTS_RESOURCE_ID=seed-tts-2.0\nVOLC_TTS_SPEAKER=zh_female_vv_uranus_bigtts\nVOLC_TTS_MODEL=seed-tts-2.0-standard\nVOLC_TTS_SAMPLE_RATE=24000\n" > /srv/carehaven/.env && chmod 600 /srv/carehaven/.env'
```

`.env` 的键：

| 键 | 用途 |
|---|---|
| `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` | 备份脚本与后台登录（`docker/deploy.sh`、`docker/backup.sh` 读取） |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 微信一键登录；留空则接口返回 503 并说明缺少哪个变量（详见 docs/wechat-onboarding.md） |

compose 会自动读取同目录 `.env` 做变量插值，**改完 `.env` 后 `docker compose up -d` 即生效**（无需重建镜像）。

`.env` 里的超级用户口令用于备份与后台登录，**口令在服务器本地生成、不进 git**。
容器起来之后创建同口令的超级用户：

```bash
ssh <SSH_ALIAS> 'set -a; . /srv/carehaven/.env; set +a; \
  docker exec carehaven /usr/local/bin/pocketbase superuser create "$SUPERUSER_EMAIL" "$SUPERUSER_PASSWORD" --dir /pb/pb_data'
```

---

## 五、备份

- **部署前备份**：由 `deploy.sh` 自动完成（含导出到宿主机）
- **日常备份**：已登记 server-ops 统一账本，每日 04:30 自动执行（见上）

恢复：管理后台 `/_/` → Settings → Backups 点恢复最直观（**不要在运行中直接 cp SQLite 主库文件**）。

### 统一备份（**已登记 server-ops**，2026-10-15）

日常备份已纳入服务器的统一备份账本，不再手改 crontab（手改会被 `ops.sh sync` 覆盖并让 doctor 报漂移）：

| 项 | 值 |
|---|---|
| 数据集 | `carehaven-data`（声明在 `<SERVER_OPS_DIR>/backup/datasets.toml`） |
| 调度 | 受管 cron：**每日 04:30** 宿主时间（排在同机其他数据集之后，避免相互争 I/O） |
| 命令 | `cd <SERVER_OPS_DIR> && /usr/bin/python3 backup/cli.py run carehaven-data --notify` |
| 产物 | `/srv/carehaven/backups/*.zip` —— `auto-*`（每日）+ `predeploy-*`（每次部署，`deploy.sh` 产出并导出） |
| 校验 | `verify = ["unzip", "-t"]`，产物与账本由 CLI 代记 |
| 手工跑一次 | `cd <SERVER_OPS_DIR> && /usr/bin/python3 backup/cli.py run carehaven-data` |
| 查看状态 | `cd <SERVER_OPS_DIR> && /usr/bin/python3 backup/cli.py status` |

恢复：管理后台 `/_/` → Settings → Backups；或把 zip 放回容器 `/pb/pb_data/backups` 再从后台恢复。
（**不要在运行中直接 cp SQLite 主库文件**。）

---

## 六、回滚

```bash
ssh <SSH_ALIAS> 'cat /srv/carehaven/last_successful_version.txt'                    # 上次成功版本
ssh <SSH_ALIAS> 'cd /srv/carehaven && IMAGE=ghcr.io/fire-disposal/carehaven:sha-<8位> bash deploy.sh'
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

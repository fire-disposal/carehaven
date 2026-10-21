# 小程序集成豆包 TTS 的可行性（已验证）

## 结论

可行，而且不需要额外 sidecar：豆包 Seed TTS 2.0 除双向 WebSocket 外，还有 **HTTP 单向流式** 接口；PocketBase JSVM 的 `$http.send` 能直接调用它，把返回的 base64 音频分片交给客户端。这样既复用了 另一项目 / 另一实现 的 v3 凭据，又保持「单容器 + 单二进制」的部署形态。

> 关键差异：现有两个项目用的是 `wss://openspeech.bytedance.com/api/v3/tts/bidirection` 双向二进制协议；PocketBase 的 goja 运行时没有 WebSocket 客户端。改用 `https://openspeech.bytedance.com/api/v3/tts/unidirectional` 后，整个链路不需要 Node/Python 服务。

## 已验证的事实

| 验证 | 结果 |
|---|---|
| 用 另一项目 的 `VOLC_TTS_API_KEY` 调用 HTTP 单向接口 | 返回 13 段 JSON，解码出 32,301 字节 mp3（4.03 秒，64 kbps） |
| 在 PocketBase hook 内调用同一接口 | `POST /api/zz/tts` 返回 6 段 base64，约 1.2 秒 |
| 同一段文字第二次请求 | 命中 `pb_data/tts-cache`，约 6ms，返回 `cached: true` |
| H5 播放 | Taro `InnerAudioContext` 请求 `blob:` URL，HTTP 206，正常出声；停止按钮可中断 |
| 小程序路径 | 代码已按 `Taro.getEnv() === WEAPP` 分支（写本地 mp3 后播放），`build:weapp` 通过；真机未验 |
| 未配置密钥 | `/api/zz/tts/status` 返回 `available: false`，页面不渲染朗读入口 |

**验证边界**：以上播放链路是在 H5（Chromium，390×844）实测；微信开发者工具/真机未做自动化播放验证。小程序侧依赖 `FileSystemManager.writeFileSync` 与 `InnerAudioContext`，都是基础库稳定 API，但仍应在真机上确认 mp3 本地路径、静音键行为与后台切换。

## 朗读范围：结构化内容，而不是 AI 问答

朗读定位为适老化/无障碍基础设施，面向**页面声明的结构化文字**：量表说明、题目、选项、结果与建议。明确不读 AI 问答回答，原因：

- 问答回答可能很长，逐段合成等待与成本都高；
- 回答由检索/生成产生，内容与结构不稳定，更适合阅读而非朗读；
- 朗读需要稳定的「读到哪里、停在哪里」边界，题库与表单才是主场景。

页面只调用 `usePageReadAloud(text, label, withNav)` 声明文字；全局层负责：
可用性探测、悬浮入口、播放/停止、切页/切题时中止上一段。入口统一放在左下角，避开底部导航与社区发帖按钮。

## 请求形状

```http
POST https://openspeech.bytedance.com/api/v3/tts/unidirectional
Content-Type: application/json
X-Api-Key: <server-side only>
X-Api-Resource-Id: seed-tts-2.0
X-Api-Request-Id: <uuid>

{
  "req_params": {
    "text": "要朗读的文字",
    "model": "seed-tts-2.0-standard",
    "speaker": "zh_female_vv_uranus_bigtts",
    "audio_params": { "format": "mp3", "sample_rate": 24000 }
  }
}
```

响应是 HTTP Chunked 的多个 JSON 对象，不是单个 JSON：

```json
{"code":0,"message":"","data":"<base64 mp3 分片>"}
{"code":0,"message":"","data":"..."}
{"code":20000000,"message":"","data":""}
```

PocketBase hook 用字符级扫描切出每个 JSON 对象（不能按 `}{` 简单切，避免字符串里的花括号），收集 `data` 后原样返回给客户端。客户端把分片拼成一个 base64 串再解码。

## 数据流

```mermaid
flowchart LR
  A[量表页 / 全局朗读层] -->|POST /api/zz/tts| B[PocketBase hook]
  B -->|X-Api-Key| C[豆包 HTTP 单向 TTS]
  C -->|chunked JSON + base64| B
  B -->|chunks[]| A
  A -->|H5: Blob URL| D[InnerAudioContext]
  A -->|WEAPP: 写 mp3| D
```

## 复用方式

| 现有资产 | 位置 | 复用情况 |
|---|---|---|
| v3 凭据与环境变量 | 另一项目 `.env` / `tts/config.ts` | 直接复用变量名与默认值 |
| 音色 / 模型默认值 | 另一实现 `voice_config`、另一项目 `config.ts` | `seed-tts-2.0` / `zh_female_vv_uranus_bigtts` |
| 协议实现 | 另一实现 `infra/tts/client.py`、另一项目 `features/tts/volc.ts` | 未直接搬：它们是 WebSocket；保留作未来流式方案参考 |
| 缓存 / 熔断 / 计价 | 另一项目 `tts/cache.ts`、`circuit.ts`、`pricing.ts` | 概念可复用，当前实现未加缓存与熔断 |
| 音频交付 | 另一项目 `features/session/speech.ts`（PCM + WebAudio） | 小程序不能直接用 WebAudio/PCM，改为 mp3 + InnerAudioContext |

## 小程序侧约束

- **域名白名单**：客户端只请求同源 `/api/zz/tts`，音频以 base64 返回，不需要额外的音频域名，也不需要 `downloadFile` 白名单。
- **格式**：mp3 24kHz 是 `InnerAudioContext` 支持面最广的组合；不用 PCM，省掉 WebAudio。
- **首响**：实测短句约 1.2 秒、54 字约 2.3 秒、90 字约 3.7 秒、190 字约 7.3 秒；按钮先显示「准备语音…」，成功后切到「停止朗读」。因此客户端按约 90 字切分，预取下一段。
- **长度**：官方单次上限约 200 字；客户端按约 90 字切句、预取下一段后顺序播放，兼顾首响与段间空隙。
- **播放策略**：`obeyMuteSwitch = false`，用户主动点朗读时不被静音键吞掉；页面隐藏 / 卸载时停止。
- **一次一个会话**：新朗读会停掉旧的；用递增 session id 丢弃旧请求的回调。

## 风险与未做

1. **缓存已做，但无淘汰**：服务端按 `text + model + speaker + sample_rate + resource_id` 落盘到 `pb_data/tts-cache/<sha256>.json`，同文第二次约 6ms；问答回答来自知识库、集合有限，暂未做 LRU/TTL。缓存可随时整体删除，不影响数据。缓存在 `pb_data` 内，会随 PocketBase 备份一起打包；若后续接入 LLM 产生大量不同回答，应迁到独立卷并加 TTL。
2. **无限流**：只做了登录校验与 200 字上限，没有按用户日配额。公开运营前需要加计数与熔断。
3. **长文本体验**：按句切分后是逐段请求 + 逐段播放，段间可能有几十毫秒空隙；对问答答案可接受，对整篇长文不理想。
4. **上游可用性**：当前失败只返回 502 + toast；可加短暂重试与「语音暂不可用」的降级提示。
5. **隐私**：朗读文本会发送到豆包；隐私政策已写明第三方处理语音合成所需文本，但未单独列出供应商名称。正式上线前应补充。

## 落地文件

- `pb_hooks/tts.pb.js`：状态与合成路由、chunked JSON 解析、持久化缓存。
- `miniapp/src/lib/tts.ts`：切句、请求、base64 → 文件/Blob、顺序播放、停止。
- `miniapp/src/lib/readAloud.tsx`：全局朗读层，页面声明文字与统一悬浮入口。
- `miniapp/src/pages/assessment/index.tsx`：量表列表 / 题目 / 结果的朗读文本声明。
- `.env.example` / `docker-compose.yml`：`VOLC_TTS_*` 变量。
- `README.md`：部署说明。

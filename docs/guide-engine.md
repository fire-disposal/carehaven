# 引导练习引擎与音频抽象

> 状态：已落地 4 门课程（四拍呼吸、4-7-8、身体扫描、五感落地），H5 动画 + 合成提示音/环境声可用；小程序端沿用同一时间线，音频降级静音。
> 代码：`miniapp/src/lib/guide.ts`、`lib/audio.ts`、`components/guide/`、`pages/guide/`。

## 1. 边界

| 层 | 负责 | 不负责 |
|---|---|---|
| `lib/guide.ts` | 课程脚本、阶段时长、时间线状态机（暂停/进度） | 动画、音色、页面布局 |
| `components/guide/*` | 表现：呼吸圆、场景背景、阶段条 | 计时、文案脚本 |
| `lib/audio.ts` | 提示音、环境声、静音降级 | 旁白文本、TTS |
| `pages/guide` | 组合三者 + 完成评分 + 写 `intervention_logs` | 定义课程内容 |

页面只向组件传 `phase.kind / seconds`，新增课程不用改动画；新增动画只需新增组件并按 `scene` 选择，不碰时间线。

## 2. 课程脚本

```ts
interface GuidePhase { kind: 'inhale'|'hold'|'exhale'|'rest'|'prompt'; label: string; detail?: string; seconds: number }
interface GuideScript { id; title; subtitle; scene: 'breath'|'scan'|'ground'; ambient: 'none'|'rain'; phases: GuidePhase[] }
```

- 时间线按 `Date.now()` 推算，切后台回来不漂移；暂停即冻结 elapsed。
- UI 用 `PhaseTrack` 显示阶段（呼吸课显示「吸/停/呼/停」，其他课显示编号），当前段高亮，已完成段变浅。

## 3. 音频抽象

```ts
interface AudioBus {
  unlock(): Promise<void>
  cue(kind: 'start'|'phase'|'end'): void
  setAmbient(kind: 'none'|'rain'): void
  setMuted(muted: boolean): void
  destroy(): void
}
```

- H5：WebAudio 合成正弦提示音；环境声用过滤白噪生成，不依赖外部音频文件。
- 无 WebAudio（小程序/旧环境）：`SilentBus`，引导时长与画面照常，不报错。
- 后续接真人旁白/TTS：实现 `NarrationPlayer`（`play(url)`/`stop`）并在页面注入；`AudioBus` 与脚本不动。

## 4. 入口与完成回路

1. 减压页每个方案直接给「开始 · <课程名>」，不再先展开详情再找按钮。
2. `pages/guide` 打开即显示课程名、时长、开始；进行中只有阶段条、动画/提示、计时与三个控制（暂停、声音、结束）。
3. 结束（或走完）进入完成态：1–5 星 + 实际时长 → 写 `intervention_logs` 与 `ratings`，返回减压页。

## 5. 扩展点

- 新课程：在 `GUIDE_SCRIPTS` 加一段 `phases`，必要时复用 `scene`。
- 新动画：新增 `components/guide/*`，在 `pages/guide` 按 `script.scene` 选择；动画只依赖阶段与时长。
- 新音频：实现 `AudioBus` 或旁白播放器，页面只替换注入实例。
- 无障碍：`prefers-reduced-motion` 下呼吸圆与漂浮动画关闭，文字节奏保留。

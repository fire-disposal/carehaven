// 拼句词库与渲染规则
//
// 设计约束（与产品决策绑定，改动前先看 docs/ugc-archive.md）：
//   1. 用户不提交任何自由文本；只提交「槽位 + 词元 id」。
//   2. 句子由服务端拼接，粘合词（逗号/句号）写在 render 规则里，
//      保证任意组合都成句——词元自己的措辞必须适配固定粘合词。
//   3. 词元只能通过发版变更（git 可审），不接受运行时后台编辑。
//
// 槽位与组合数：8 场景 × 8 感受 × 8 做法（可选）× 7 想说 ≈ 3584 种。

const VERSION = '2026-11-2'

const SLOTS = {
  // 措辞刻意写得笼统：不写具体次数、不写具体身体动作，避免读起来像段子，
  // 也降低把第三方细节写进公开留言的风险。
  scene: [
    { id: 'night_wander', text: '夜里那一阵' },
    { id: 'same_question', text: '同一个问题又问了一遍' },
    { id: 'not_recognize', text: '他看我的眼神有点陌生' },
    { id: 'refuse_food', text: '这顿饭吃了很久' },
    { id: 'refuse_out', text: '出门前就耗住了' },
    { id: 'temper', text: '情绪突然上来了' },
    { id: 'alone_day', text: '一整天只有我们两个' },
    { id: 'finally_asleep', text: '他终于睡着以后' },
    { id: 'sundown', text: '天快黑的时候' },
    { id: 'quiet', text: '家里忽然安静下来' },
  ],
  feeling: [
    { id: 'exhausted', text: '我说不出话' },
    { id: 'afraid', text: '心里发紧' },
    { id: 'wronged', text: '有点委屈' },
    { id: 'irritable', text: '烦，又有点愧疚' },
    { id: 'blank', text: '想放空一会' },
    { id: 'calm', text: '意外地平静' },
    { id: 'breaking', text: '快到极限了' },
    { id: 'lonely', text: '想有人替我一会儿' },
    { id: 'empty', text: '整个人是空的' },
    { id: 'worried', text: '总担心下一步' },
  ],
  tried: [
    { id: 'night_light', text: '我把灯留着了' },
    { id: 'write_note', text: '我换了个说法' },
    { id: 'sit_wait', text: '我先坐下来等' },
    { id: 'ask_help', text: '我请人搭了把手' },
    { id: 'ten_min', text: '我出去站了一会' },
    { id: 'remind_early', text: '我提前说了一声' },
    { id: 'nothing', text: '我还没找到办法' },
    { id: 'keep_quiet', text: '我先没说话' },
    { id: 'reroute', text: '我把顺序调了一下' },
    { id: 'sound', text: '我放了点声音' },
  ],
  wish: [
    { id: 'anyone_else', text: '有人也遇到吗' },
    { id: 'how_did_you', text: '后来怎么处理的' },
    { id: 'need_words', text: '想听一句「已经够好了」' },
    { id: 'hug', text: '抱抱同样在熬的人' },
    { id: 'breathe', text: '想给自己留口气' },
    { id: 'new_try', text: '明天换个法子' },
    { id: 'be_heard', text: '只想被听见' },
    { id: 'sleep', text: '想睡个整觉' },
    { id: 'steady', text: '想稳一稳再说' },
  ],
}

const KINDS = ['分享', '求助', '陪伴']

// 固定回应：比自由评论更克制，也免去文本审核。一人一帖一个回应。
const REACTIONS = ['我也是', '抱抱', '有用', '加油']

const REPORT_REASONS = ['暴露隐私', '攻击他人', '不合适', '其他']

// 渲染规则：缺少可选槽位时整条跳过，不做空串拼接。
const RENDER = [
  { slot: 'scene', required: true, glue: '，' },
  { slot: 'feeling', required: true, glue: '。' },
  { slot: 'tried', required: false, glue: '。' },
  { slot: 'wish', required: true, glue: '。' },
]

// 内置组合：一次点选就能得到一句通顺的话，比逐项挑四个槽位省事
// 组合必须落在上面四个槽位的词元里，改动时两边一起改（启动时会做存在性校验）。
const PRESETS = [
  {
    id: 'night_share',
    label: '夜里',
    kind: '分享',
    terms: { scene: 'night_wander', feeling: 'exhausted', tried: 'night_light', wish: 'anyone_else' },
  },
  {
    id: 'alone_share',
    label: '白天',
    kind: '分享',
    terms: { scene: 'alone_day', feeling: 'lonely', tried: 'nothing', wish: 'hug' },
  },
  {
    id: 'ask_repeat',
    label: '重复',
    kind: '求助',
    terms: { scene: 'same_question', feeling: 'breaking', tried: 'write_note', wish: 'how_did_you' },
  },
  {
    id: 'ask_recognize',
    label: '陌生',
    kind: '求助',
    terms: { scene: 'not_recognize', feeling: 'wronged', tried: 'sit_wait', wish: 'be_heard' },
  },
  {
    id: 'company_breathe',
    label: '喘口气',
    kind: '陪伴',
    terms: { scene: 'finally_asleep', feeling: 'calm', tried: 'ten_min', wish: 'breathe' },
  },
  {
    id: 'company_tomorrow',
    label: '明天',
    kind: '陪伴',
    terms: { scene: 'temper', feeling: 'blank', tried: 'keep_quiet', wish: 'new_try' },
  },
]

const MAX_TEXT = 200
// 每人每日发帖上限：结构化内容不该被刷屏，也顺带压住滥用成本。
const DAILY_POST_LIMITS = 5
// 同一帖被多少个不同用户举报后自动隐藏（等人工复核）。
const AUTO_HIDE_REPORTS = 3

function index(slotName) {
  const list = SLOTS[slotName]
  const map = {}
  for (let i = 0; i < list.length; i += 1) map[list[i].id] = list[i]
  return map
}

const SLOT_INDEX = {
  scene: index('scene'),
  feeling: index('feeling'),
  tried: index('tried'),
  wish: index('wish'),
}

function publicLexicon() {
  return {
    version: VERSION,
    kinds: KINDS,
    reactions: REACTIONS,
    reportReasons: REPORT_REASONS,
    maxText: MAX_TEXT,
    dailyPostLimit: DAILY_POST_LIMITS,
    render: RENDER,
    slots: SLOTS,
    presets: PRESETS,
  }
}

/** 校验并归一化：只返回词元 id，未知字段一律丢弃。 */
function normalizeTerms(input) {
  const source = input && typeof input === 'object' ? input : {}
  const out = {}
  for (let i = 0; i < RENDER.length; i += 1) {
    const rule = RENDER[i]
    const raw = source[rule.slot]
    if (raw === undefined || raw === null || raw === '') {
      if (rule.required) throw new Error('请选择' + rule.slot)
      continue
    }
    const id = String(raw)
    if (!Object.prototype.hasOwnProperty.call(SLOT_INDEX[rule.slot], id)) {
      throw new Error('词元不在词库中：' + rule.slot)
    }
    out[rule.slot] = id
  }
  return out
}

/** 渲染：服务端唯一真源，客户端预览用同一份 render 规则。 */
function compose(terms) {
  const normalized = normalizeTerms(terms)
  let text = ''
  for (let i = 0; i < RENDER.length; i += 1) {
    const rule = RENDER[i]
    const id = normalized[rule.slot]
    if (!id) continue
    text += SLOT_INDEX[rule.slot][id].text + rule.glue
  }
  return { text: text, terms: normalized }
}

/** 组合必须只引用词库里存在的词元，且必选槽位齐全 */
function validatePresets() {
  for (let i = 0; i < PRESETS.length; i += 1) {
    const preset = PRESETS[i]
    const composed = compose(preset.terms)
    if (!composed.text) throw new Error('内置组合无法成句：' + preset.id)
    if (!isKind(preset.kind)) throw new Error('内置组合的分类无效：' + preset.id)
  }
}

validatePresets()

function isKind(value) {
  return KINDS.indexOf(String(value)) >= 0
}

function isReaction(value) {
  return REACTIONS.indexOf(String(value)) >= 0
}

function isReportReason(value) {
  return REPORT_REASONS.indexOf(String(value)) >= 0
}

module.exports = {
  VERSION: VERSION,
  MAX_TEXT: MAX_TEXT,
  DAILY_POST_LIMITS: DAILY_POST_LIMITS,
  AUTO_HIDE_REPORTS: AUTO_HIDE_REPORTS,
  REACTIONS: REACTIONS,
  publicLexicon: publicLexicon,
  normalizeTerms: normalizeTerms,
  compose: compose,
  isKind: isKind,
  isReaction: isReaction,
  isReportReason: isReportReason,
}

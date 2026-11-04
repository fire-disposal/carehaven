// 研究分组与窗口计算
//
// 规则：
//   - 区组分配：按各臂 ratio 的"已入组人数 / 配比"最小者优先，相等时随机；
//     这样任意时刻组间人数比例都贴近设计配比，不受退出影响（退出不从分母移除）。
//   - 窗口：研究 schedule 里每项 { day, scales, window }，day 相对入组日；
//     评估是否在窗内由导出/报表按 created 与 due 的差计算，不依赖客户端自报。

const DAY_MS = 86400000

function toDate(value) {
  if (!value) return null
  const d = new Date(String(value).includes(' ') ? String(value).replace(' ', 'T') : String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

function pbTime(date) {
  return date.toISOString().replace('T', ' ')
}

/** UTF-8 字节数组 → 字符串（json 字段在 JSVM 里可能是字节数组） */
function decodeBytes(bytes) {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i += 1
    } else if (b >= 0xc0 && b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      i += 2
    } else if (b >= 0xe0 && b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
      i += 3
    } else {
      out += '\uFFFD'
      i += 4
    }
  }
  return out
}

/** 读取并规范化 schedule：[{day, scales:[...], window}] */
function normalizeSchedule(raw) {
  let list = raw
  if (Array.isArray(list) && list.length > 0 && typeof list[0] === 'number') {
    try {
      list = JSON.parse(decodeBytes(list))
    } catch (e) {
      list = null
    }
  }
  if (typeof list === 'string' && list.trim() !== '') {
    try {
      list = JSON.parse(list)
    } catch (e) {
      list = null
    }
  }
  if (!Array.isArray(list)) return []
  return list
    .map((item) => ({
      day: Number(item && item.day),
      scales: Array.isArray(item && item.scales) ? item.scales.map(String) : [],
      window: Number.isFinite(Number(item && item.window)) ? Number(item.window) : 3,
    }))
    .filter((item) => Number.isFinite(item.day) && item.day >= 0 && item.scales.length > 0)
    .sort((a, b) => a.day - b.day)
}

/** 某个窗口的截止与是否已过期 */
function windowState(item, assignedAt, now) {
  const start = toDate(assignedAt)
  if (!start) return { due_at: '', open: false, late: false }
  const due = new Date(start.getTime() + item.day * DAY_MS)
  const close = new Date(due.getTime() + item.window * DAY_MS)
  return {
    due_at: pbTime(due),
    open: now >= new Date(due.getTime() - item.window * DAY_MS) && now <= close,
    late: now > close,
  }
}

/**
 * 选臂：最小化 assigned/ratio。
 * @param arms   [{ id, code, label, ratio }]
 * @param counts { [armId]: number }
 */
function pickArm(arms, counts) {
  const candidates = arms.filter((arm) => Number(arm.ratio) > 0)
  if (candidates.length === 0) return null
  let best = []
  let bestScore = Infinity
  for (const arm of candidates) {
    const assigned = Number(counts[arm.id] || 0)
    const score = assigned / Number(arm.ratio)
    if (score < bestScore - 1e-9) {
      bestScore = score
      best = [arm]
    } else if (Math.abs(score - bestScore) <= 1e-9) {
      best.push(arm)
    }
  }
  return best[Math.floor(Math.random() * best.length)]
}

/** 研究是否在开放期内 */
function isOpen(study, now) {
  const opens = toDate(study.get('opens_at'))
  const closes = toDate(study.get('closes_at'))
  if (opens && now < opens) return false
  if (closes && now > closes) return false
  return true
}

module.exports = {
  DAY_MS: DAY_MS,
  toDate: toDate,
  pbTime: pbTime,
  normalizeSchedule: normalizeSchedule,
  windowState: windowState,
  pickArm: pickArm,
  isOpen: isOpen,
}

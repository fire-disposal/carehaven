// 量表定义与计分
//
// 只做「筛查」：分数与分级按公开量表规则计算，不输出诊断结论。
// 客户端有同一份题库/选项（miniapp/src/lib/scales.ts），改题时两边必须同步。

const SCALES = {
  zbi12: {
    name: '照护负担自评',
    items: 12,
    maxPerItem: 4,
    maxScore: 48,
    bands: [
      { upTo: 20, severity: '低负担', level: 'green' },
      { upTo: 40, severity: '中等负担', level: 'yellow' },
      { upTo: 48, severity: '高负担', level: 'red' },
    ],
  },
  phq9: {
    name: '情绪状态自评',
    items: 9,
    maxPerItem: 3,
    maxScore: 27,
    bands: [
      { upTo: 4, severity: '无或极少', level: 'green' },
      { upTo: 9, severity: '轻度', level: 'yellow' },
      { upTo: 14, severity: '中度', level: 'yellow' },
      { upTo: 19, severity: '中重度', level: 'red' },
      { upTo: 27, severity: '重度', level: 'red' },
    ],
    // 第 9 题（索引 8）只要不为 0 就触发安全提示
    safetyItem: 8,
  },
  gad7: {
    name: '焦虑状态自评',
    items: 7,
    maxPerItem: 3,
    maxScore: 21,
    bands: [
      { upTo: 4, severity: '无或极少', level: 'green' },
      { upTo: 9, severity: '轻度', level: 'yellow' },
      { upTo: 14, severity: '中度', level: 'yellow' },
      { upTo: 21, severity: '重度', level: 'red' },
    ],
  },
}

const ADVICE = {
  green: '当前结果在一般范围内。继续保持规律作息、给自己留出休息时间；如果最近压力变大，可以每周再测一次。',
  yellow: '结果提示近期有一定负担或情绪波动。建议本周安排一次放松练习，并把照护任务分担给家人；持续两周以上可考虑咨询专业人员。',
  red: '结果提示负担或情绪困扰较明显。请优先联系家人或专业人员，获得实际支持；这不是诊断，但值得尽快认真对待。',
}

function fail(msg) {
  const err = new Error(msg)
  err.isValidation = true
  throw err
}

function score(scaleKey, answers) {
  const def = SCALES[scaleKey]
  if (!def) fail('未知的量表')
  if (!Array.isArray(answers) || answers.length !== def.items) {
    fail('答案数量不正确，请重新作答')
  }

  let total = 0
  for (let i = 0; i < answers.length; i += 1) {
    const v = answers[i]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > def.maxPerItem) {
      fail('答案取值不正确，请重新作答')
    }
    total += Math.round(v)
  }

  let band = def.bands[def.bands.length - 1]
  for (let i = 0; i < def.bands.length; i += 1) {
    if (total <= def.bands[i].upTo) {
      band = def.bands[i]
      break
    }
  }

  const flag =
    typeof def.safetyItem === 'number' && Number(answers[def.safetyItem]) > 0 ? true : false

  return {
    scale: scaleKey,
    scaleName: def.name,
    score: total,
    maxScore: def.maxScore,
    severity: band.severity,
    level: band.level,
    advice: ADVICE[band.level],
    flag: flag,
  }
}

module.exports = { SCALES: SCALES, score: score }

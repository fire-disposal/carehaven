// 术语与状态文案：分级、数据来源、缺失说明、安全入口
//
// 页面里不要再写「压力平稳 / 数据不足 / 模拟数据」这类字面量，统一从这里取。

export type LevelTone = 'green' | 'yellow' | 'red' | 'quiet'
export type LevelKey = 'green' | 'yellow' | 'red' | 'unknown'

export const LEVEL_TEXT: Record<LevelKey, string> = {
  green: '压力平稳',
  yellow: '压力预警',
  red: '压力偏高',
  unknown: '数据不足',
}

export const LEVEL_SHORT: Record<'green' | 'yellow' | 'red', string> = {
  green: '平稳',
  yellow: '预警',
  red: '偏高',
}

export const LEVEL_RANGE: Record<'green' | 'yellow' | 'red', string> = {
  green: '0–39',
  yellow: '40–69',
  red: '70–100',
}

export const LEVEL_TITLE: Record<LevelKey, string> = {
  green: '绿色 · 压力平稳',
  yellow: '黄色 · 压力预警',
  red: '红色 · 压力偏高',
  unknown: '数据不足 · 尚不分层',
}

export const LEVEL_DESC: Record<LevelKey, string> = {
  unknown: '今天记录不足，无法给出分层。补一次打卡或生理数据后会自动更新。',
  green: '各项记录在平稳范围内，保持原有作息即可。',
  yellow: '压力近几天有累积。今天安排一次放松练习，并留意睡眠。',
  red: '压力持续偏高。建议联系家人或专业人员分担一部分照护。',
}

export const NO_SCORE_TEXT = '尚未评估'
export const NO_SCORE_ADVICE = '暂无评估结果，完成一次打卡即可生成。'
export const MISSING_COMPONENT = '--'

export type PhysioSource = 'device' | 'manual' | 'simulated'

export const SOURCE_LABEL: Record<PhysioSource, string> = {
  device: '设备采集',
  manual: '手动录入',
  simulated: '合成数据',
}

/** 来源说明：来源不同，措辞必须不同，不能把模拟说成采集 */
export const SOURCE_NOTE: Record<PhysioSource, string> = {
  device: '由已登记的蓝牙设备同步。',
  simulated: '这是用于功能演示的合成数据，不是真实测量结果。',
  manual: '这是您手动填写的记录，不是设备测量。',
}

/** 安全与免责：所有页面共用一套措辞 */
export const SAFETY = {
  hotline: '12356',
  emergency: '120',
  hotlineLabel: '全国心理援助热线',
  emergencyCard: {
    title: '需要立即帮助时',
    text: '如果您或家人有伤害自己或他人的风险，请立即拨打 120，或前往最近的急诊。需要有人听您说说话，可以拨打全国心理援助热线 12356。',
  },
  disclaimer: '结果不是诊断，也不能替代医生或心理咨询师的专业评估。',
} as const

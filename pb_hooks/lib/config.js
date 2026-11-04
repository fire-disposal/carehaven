// app_config 的读取与校验
//
// 配置是「政策参数」：权重与阈值一旦被改，历史分数就失去参照。
// 所以写入必须过校验，并留下变更历史（app_config_history）。

/** UTF-8 字节数组 → 字符串（JSVM 的 json 字段可能以字节数组返回） */
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

/** JSON 字段读取：API 写入是对象，迁移/旧数据可能是 UTF-8 字节数组 */
function normalizeValue(value) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    try {
      return JSON.parse(decodeBytes(value))
    } catch (err) {
      return null
    }
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch (err) {
      return null
    }
  }
  return value
}

function fail(message) {
  const err = new Error(message)
  err.isValidation = true
  throw err
}

function near(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance
}

function validateWeights(value) {
  const v = value && typeof value === 'object' ? value : null
  if (!v) fail('hps_weights 必须是对象 {w1, w2, w3}')
  const keys = ['w1', 'w2', 'w3']
  let sum = 0
  for (let i = 0; i < keys.length; i += 1) {
    const w = Number(v[keys[i]])
    if (!Number.isFinite(w) || w < 0 || w > 1) fail('权重必须是 0–1 之间的数：' + keys[i])
    sum += w
  }
  if (!near(sum, 1, 0.001)) fail('权重之和必须为 1，当前为 ' + sum.toFixed(3))
}

function validateThresholds(value) {
  const v = value && typeof value === 'object' ? value : null
  if (!v) fail('level_thresholds 必须是对象 {t_green, t_red}')
  const green = Number(v.t_green)
  const red = Number(v.t_red)
  if (!Number.isFinite(green) || !Number.isFinite(red)) fail('阈值必须是数字')
  if (green < 0 || red > 100) fail('阈值必须在 0–100 之间')
  if (!(green < red)) fail('阈值必须满足 t_green < t_red')
}

function validateRanges(value) {
  const v = value && typeof value === 'object' ? value : null
  if (!v) fail('physio_normal_range 必须是对象')
  const keys = ['hrv', 'gsr', 'sleep_quality']
  for (let i = 0; i < keys.length; i += 1) {
    const pair = v[keys[i]]
    if (!Array.isArray(pair) || pair.length !== 2) fail('区间必须是 [lo, hi]：' + keys[i])
    const lo = Number(pair[0])
    const hi = Number(pair[1])
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) fail('区间端点必须是数字：' + keys[i])
    if (!(lo < hi)) fail('区间必须 lo < hi：' + keys[i])
  }
}

/** 校验一条 app_config；未知 key 放行（例如未来的开关） */
function validate(key, rawValue) {
  const value = normalizeValue(rawValue)
  if (key === 'hps_weights') validateWeights(value)
  else if (key === 'level_thresholds') validateThresholds(value)
  else if (key === 'physio_normal_range') validateRanges(value)
  return value
}

/**
 * 写入一条配置变更历史。
 * 注意：hook 处理器在独立运行时执行，不能调用 hook 文件顶层函数——所以历史逻辑放在这里，
 * 由处理器内部 require 后调用。
 */
function recordHistory(record, author, reason) {
  const history = new Record($app.findCollectionByNameOrId('app_config_history'))
  history.set('key', String(record.get('key') || ''))
  history.set('value', normalizeValue(record.get('value')))
  history.set('author', String(author || 'admin'))
  history.set('reason', String(reason || 'update'))
  history.set('effective_from', new Date().toISOString().replace('T', ' '))
  $app.save(history)
}

module.exports = {
  normalizeValue: normalizeValue,
  validate: validate,
  recordHistory: recordHistory,
}

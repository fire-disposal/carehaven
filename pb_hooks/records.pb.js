/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 打卡与生理数据的服务端写入
//
// 客户端不再直写集合：服务端负责 user / date / source 与范围校验，
// 写入后触发评分重算。这样可以排除"补录未来日期""伪造设备来源"这类污染。
//
//   POST /api/zz/checkins        { period, mood, anxiety, fatigue, sleep_hours, care_hours, note? }
//   POST /api/zz/physio/manual   { hrv, gsr, sleep_quality, steps }
// ---------------------------------------------------------------------------

routerAdd(
  'POST',
  '/api/zz/checkins',
  function (e) {
    const info = e.requestInfo()
    const body = info.body || {}
    const user = info.auth

    const period = String(body.period || '')
    const mood = Number(body.mood)
    const anxiety = Number(body.anxiety)
    const fatigue = Number(body.fatigue)
    const sleepHours = Number(body.sleep_hours)
    const careHours = Number(body.care_hours)
    const note = String(body.note || '').slice(0, 500)

    if (period !== 'morning' && period !== 'evening') {
      return e.badRequestError('请选择记录时段', null)
    }
    if (!Number.isFinite(mood) || mood < 1 || mood > 5) {
      return e.badRequestError('心情取值需在 1–5 之间', null)
    }
    if (!Number.isFinite(anxiety) || anxiety < 0 || anxiety > 10) {
      return e.badRequestError('焦虑取值需在 0–10 之间', null)
    }
    if (!Number.isFinite(fatigue) || fatigue < 0 || fatigue > 10) {
      return e.badRequestError('疲惫取值需在 0–10 之间', null)
    }
    if (!Number.isFinite(sleepHours) || sleepHours < 0 || sleepHours > 24) {
      return e.badRequestError('睡眠时长需在 0–24 小时之间', null)
    }
    if (!Number.isFinite(careHours) || careHours < 0 || careHours > 24) {
      return e.badRequestError('照护时长需在 0–24 小时之间', null)
    }

    const now = new Date()
    const record = new Record($app.findCollectionByNameOrId('checkins'))
    try {
      record.set('user', user.id)
      record.set('date', now.toISOString().replace('T', ' '))
      record.set('period', period)
      record.set('mood', Math.round(mood))
      record.set('anxiety', anxiety)
      record.set('fatigue', fatigue)
      record.set('sleep_hours', sleepHours)
      record.set('care_hours', careHours)
      record.set('note', note)
      $app.save(record)
    } catch (err) {
      $app.logger().error('打卡保存失败', 'error', String(err))
      return e.json(500, { message: '打卡暂时没能保存，请稍后再试' })
    }

    return e.json(200, { id: record.id, date: String(record.get('date') || '') })
  },
  $apis.requireAuth()
)

routerAdd(
  'POST',
  '/api/zz/physio/manual',
  function (e) {
    const info = e.requestInfo()
    const body = info.body || {}
    const user = info.auth

    const hrv = body.hrv === null || body.hrv === '' ? null : Number(body.hrv)
    const gsr = body.gsr === null || body.gsr === '' ? null : Number(body.gsr)
    const sleepQuality =
      body.sleep_quality === null || body.sleep_quality === '' ? null : Number(body.sleep_quality)
    const steps = Number(body.steps)

    if (hrv !== null && (!Number.isFinite(hrv) || hrv < 0 || hrv > 200)) {
      return e.badRequestError('HRV 需在 0–200 之间', null)
    }
    if (gsr !== null && (!Number.isFinite(gsr) || gsr < 0 || gsr > 50)) {
      return e.badRequestError('皮肤电需在 0–50 之间', null)
    }
    if (sleepQuality !== null && (!Number.isFinite(sleepQuality) || sleepQuality < 0 || sleepQuality > 100)) {
      return e.badRequestError('睡眠质量需在 0–100 之间', null)
    }
    if (hrv === null && gsr === null && sleepQuality === null) {
      return e.badRequestError('至少填写一项生理指标', null)
    }

    const now = new Date()
    const record = new Record($app.findCollectionByNameOrId('physio_records'))
    try {
      record.set('user', user.id)
      record.set('date', now.toISOString().replace('T', ' '))
      // 来源由服务端决定：这条路由只接受手动录入
      record.set('source', 'manual')
      if (hrv !== null) record.set('hrv', hrv)
      if (gsr !== null) record.set('gsr', gsr)
      if (sleepQuality !== null) record.set('sleep_quality', Math.round(sleepQuality))
      if (Number.isFinite(steps) && steps >= 0) record.set('steps', Math.round(steps))
      $app.save(record)
    } catch (err) {
      $app.logger().error('生理数据保存失败', 'error', String(err))
      return e.json(500, { message: '数据暂时没能保存，请稍后再试' })
    }

    return e.json(200, { id: record.id, date: String(record.get('date') || '') })
  },
  $apis.requireAuth()
)

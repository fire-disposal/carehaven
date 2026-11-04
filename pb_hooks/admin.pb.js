/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 运营台接口（仅超管）
//
//   GET  /api/zz/admin/overview                 今日概览与待处置
//   GET  /api/zz/admin/moderation/queue         举报/隐藏队列
//   GET  /api/zz/admin/studies/{id}/quality     按臂质量
//   POST /api/zz/admin/study                    创建研究 + 分组（表单化，带校验）
//   POST /api/zz/admin/study/{id}/status        启停研究
//
// 只读聚合 + 少量受控写入；其余集合 CRUD 由超管直接走 REST。
// ---------------------------------------------------------------------------

routerAdd(
  'GET',
  '/api/zz/admin/overview',
  function (e) {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      .toISOString()
      .replace('T', ' ')

    function count(collection, filter, params) {
      try {
        return $app.findRecordsByFilter(collection, filter || '', '', 1, 0, params || {}).length
      } catch (err) {
        return 0
      }
    }

    function countAll(collection, filter, params) {
      try {
        return $app.findRecordsByFilter(collection, filter || '', '', 2000, 0, params || {}).length
      } catch (err) {
        return 0
      }
    }

    const todayParams = { start: start }
    const overview = {
      today: {
        checkins: countAll('checkins', 'created >= {:start}', todayParams),
        physio: countAll('physio_records', 'created >= {:start}', todayParams),
        assessments: countAll('assessments', 'created >= {:start}', todayParams),
        whispers: countAll('whispers', 'created >= {:start}', todayParams),
        scores: countAll('stress_scores', 'date >= {:start}', todayParams),
      },
      users: countAll('users', '', {}),
      pending: {
        reported: countAll('whispers', 'report_count > 0 && hidden = false', {}),
        hidden: countAll('whispers', 'hidden = true', {}),
      },
      quota: { ask: 0, tts: 0 },
      studies: { active: 0, enrolled_active: 0 },
    }

    try {
      const usage = $app.findRecordsByFilter(
        'usage_counters',
        'date >= {:start}',
        '',
        500,
        0,
        { start: start }
      )
      for (const row of usage) {
        const kind = String(row.get('kind'))
        const n = Number(row.get('count')) || 0
        if (kind === 'ask') overview.quota.ask += n
        if (kind === 'tts') overview.quota.tts += n
      }
    } catch (err) {
      // 集合缺失时保持 0
    }

    try {
      overview.studies.active = countAll('studies', 'status = "active"', {})
      overview.studies.enrolled_active = countAll('study_enrollments', 'status = "active"', {})
    } catch (err) {
      // 忽略
    }

    overview.generated_at = now.toISOString()
    return e.json(200, overview)
  },
  $apis.requireSuperuserAuth()
)

routerAdd(
  'GET',
  '/api/zz/admin/moderation/queue',
  function (e) {
    const info = e.requestInfo()
    const limit = Math.min(100, Math.max(1, Number(info.query.limit) || 50))

    let rows = []
    try {
      rows = $app.findRecordsByFilter(
        'whispers',
        'report_count > 0 || hidden = true',
        '-created',
        limit,
        0
      )
    } catch (err) {
      return e.json(200, { items: [] })
    }

    const items = []
    for (const row of rows) {
      let reasons = []
      try {
        const reports = $app.findRecordsByFilter(
          'whisper_reports',
          'whisper = {:whisper}',
          '',
          50,
          0,
          { whisper: row.id }
        )
        reasons = reports.map((r) => String(r.get('reason')))
      } catch (err) {
        reasons = []
      }
      items.push({
        id: row.id,
        text: String(row.get('text') || ''),
        kind: String(row.get('kind') || ''),
        nickname: String(row.get('nickname') || ''),
        anonymous: row.get('anonymous') === true,
        report_count: Number(row.get('report_count')) || 0,
        hidden: row.get('hidden') === true,
        created: String(row.get('created') || ''),
        reasons: reasons,
      })
    }

    return e.json(200, { items: items })
  },
  $apis.requireSuperuserAuth()
)

routerAdd(
  'GET',
  '/api/zz/admin/studies/{id}/quality',
  function (e) {
    const id = e.request.pathValue('id')
    let study
    try {
      study = $app.findRecordById('studies', id)
    } catch (err) {
      return e.notFoundError('研究不存在', null)
    }

    let arms = []
    try {
      arms = $app.findRecordsByFilter('study_arms', 'study = {:study}', 'code', 20, 0, { study: id })
    } catch (err) {
      arms = []
    }

    const byArm = {}
    for (const arm of arms) {
      byArm[arm.id] = {
        code: String(arm.get('code')),
        label: String(arm.get('label')),
        ratio: Number(arm.get('ratio')) || 0,
        enrolled: 0,
        withdrawn: 0,
        checkin_days: 0,
        assessments: 0,
      }
    }

    try {
      const enrollments = $app.findRecordsByFilter(
        'study_enrollments',
        'study = {:study}',
        '',
        2000,
        0,
        { study: id }
      )
      for (const row of enrollments) {
        const armId = String(row.get('arm'))
        if (!byArm[armId]) continue
        const bucket = byArm[armId]
        bucket.enrolled += 1
        if (row.get('status') === 'withdrawn') bucket.withdrawn += 1

        const userId = String(row.get('user'))
        const assignedAt = String(row.get('assigned_at') || '')
        try {
          const checkins = $app.findRecordsByFilter(
            'checkins',
            'user = {:user} && created >= {:start}',
            '',
            2000,
            0,
            { user: userId, start: assignedAt }
          )
          const days = {}
          for (const c of checkins) days[String(c.get('created')).slice(0, 10)] = true
          bucket.checkin_days += Object.keys(days).length
        } catch (err) {
          // 忽略
        }
        try {
          bucket.assessments += $app.findRecordsByFilter(
            'assessments',
            'user = {:user} && created >= {:start}',
            '',
            500,
            0,
            { user: userId, start: assignedAt }
          ).length
        } catch (err) {
          // 忽略
        }
      }
    } catch (err) {
      // 忽略
    }

    const armsOut = Object.keys(byArm).map((key) => {
      const row = byArm[key]
      return {
        code: row.code,
        label: row.label,
        ratio: row.ratio,
        enrolled: row.enrolled,
        withdrawn: row.withdrawn,
        checkin_days: row.checkin_days,
        assessments: row.assessments,
        mean_checkin_days: row.enrolled ? Number((row.checkin_days / row.enrolled).toFixed(2)) : null,
        withdrawal_rate: row.enrolled ? Number((row.withdrawn / row.enrolled).toFixed(3)) : null,
      }
    })

    return e.json(200, {
      study: {
        id: study.id,
        code: String(study.get('code')),
        title: String(study.get('title')),
        status: String(study.get('status')),
        protocol_version: String(study.get('protocol_version')),
        blinding: String(study.get('blinding') || 'none'),
      },
      arms: armsOut,
    })
  },
  $apis.requireSuperuserAuth()
)

routerAdd(
  'POST',
  '/api/zz/admin/study',
  function (e) {
    const studyLib = require(__hooks + '/lib/study.js')
    const info = e.requestInfo()
    const body = info.body || {}

    const code = String(body.code || '').trim().toUpperCase()
    const title = String(body.title || '').trim()
    const protocol = String(body.protocol_version || '').trim() || '1.0'
    const blinding = body.blinding === 'arm_hidden' ? 'arm_hidden' : 'none'
    const schedule = studyLib.normalizeSchedule(body.schedule)
    const arms = Array.isArray(body.arms) ? body.arms : []

    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      return e.badRequestError('研究码需为 3–32 位字母、数字、下划线或短横线', null)
    }
    if (title.length < 4) return e.badRequestError('研究名称至少 4 个字', null)
    if (schedule.length === 0) return e.badRequestError('至少配置一个评估时间点', null)
    if (arms.length < 2) return e.badRequestError('至少配置两个分组', null)

    const armCodes = {}
    let ratioSum = 0
    for (const arm of arms) {
      const armCode = String(arm.code || '').trim().toUpperCase()
      if (!/^[A-Z0-9]{1,8}$/.test(armCode)) return e.badRequestError('分组代号需为 1–8 位字母或数字', null)
      if (armCodes[armCode]) return e.badRequestError('分组代号重复：' + armCode, null)
      armCodes[armCode] = true
      const ratio = Number(arm.ratio)
      if (!Number.isFinite(ratio) || ratio <= 0) return e.badRequestError('分组配比必须大于 0', null)
      ratioSum += ratio
    }
    if (ratioSum <= 0) return e.badRequestError('配比之和必须大于 0', null)

    try {
      $app.findFirstRecordByFilter('studies', 'code = {:code}', { code: code })
      return e.badRequestError('研究码已存在：' + code, null)
    } catch (err) {
      // 不存在即继续
    }

    let studyRecord
    try {
      studyRecord = new Record($app.findCollectionByNameOrId('studies'))
      studyRecord.set('code', code)
      studyRecord.set('title', title)
      studyRecord.set('protocol_version', protocol)
      studyRecord.set('status', 'draft')
      studyRecord.set('blinding', blinding)
      studyRecord.set('schedule', schedule)
      if (body.opens_at) studyRecord.set('opens_at', String(body.opens_at))
      if (body.closes_at) studyRecord.set('closes_at', String(body.closes_at))
      if (body.notes) studyRecord.set('notes', String(body.notes).slice(0, 1000))
      $app.save(studyRecord)
    } catch (err) {
      $app.logger().error('创建研究失败', 'error', String(err))
      return e.json(500, { message: '研究创建失败，请检查字段后重试' })
    }

    try {
      for (const arm of arms) {
        const row = new Record($app.findCollectionByNameOrId('study_arms'))
        row.set('study', studyRecord.id)
        row.set('code', String(arm.code).trim().toUpperCase())
        row.set('label', String(arm.label || arm.code).slice(0, 60))
        row.set('ratio', Number(arm.ratio) || 1)
        $app.save(row)
      }
    } catch (err) {
      $app.logger().error('创建分组失败', 'error', String(err))
      return e.json(500, { message: '研究已创建，但分组写入失败，请到后台补齐' })
    }

    return e.json(200, { id: studyRecord.id, code: code, status: 'draft' })
  },
  $apis.requireSuperuserAuth()
)

routerAdd(
  'POST',
  '/api/zz/admin/study/{id}/status',
  function (e) {
    const id = e.request.pathValue('id')
    const body = e.requestInfo().body || {}
    const status = String(body.status || '')
    if (['draft', 'active', 'closed'].indexOf(status) < 0) {
      return e.badRequestError('status 只能是 draft / active / closed', null)
    }
    let study
    try {
      study = $app.findRecordById('studies', id)
    } catch (err) {
      return e.notFoundError('研究不存在', null)
    }
    study.set('status', status)
    $app.save(study)
    return e.json(200, { id: id, status: status })
  },
  $apis.requireSuperuserAuth()
)

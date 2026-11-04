/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 研究入组接口
//
//   GET  /api/zz/study/me        当前研究、组别（受盲法控制）、窗口与依从概况
//   POST /api/zz/study/enroll    用研究码入组，按配比分配组别并留痕
//   POST /api/zz/study/withdraw  退出研究（数据保留，按 ITT 统计）
//
// 研究本身由管理员在后台创建（studies / study_arms），接口只负责受试者侧。
// JSVM 约束：共享逻辑放 lib/study.js，处理器内 require。
// ---------------------------------------------------------------------------

routerAdd(
  'GET',
  '/api/zz/study/me',
  function (e) {
    const studyLib = require(__hooks + '/lib/study.js')
    const info = e.requestInfo()
    const now = new Date()

    let enrollments = []
    try {
      enrollments = $app.findRecordsByFilter(
        'study_enrollments',
        'user = {:user}',
        '-created',
        5,
        0,
        { user: info.auth.id }
      )
    } catch (err) {
      return e.json(200, { enrollment: null, study: null, schedule: [], adherence: null })
    }

    let current = null
    for (const row of enrollments) {
      if (row.get('status') === 'active') {
        current = row
        break
      }
    }
    if (!current) current = enrollments[0]
    if (!current) {
      return e.json(200, { enrollment: null, study: null, schedule: [], adherence: null })
    }

    const study = $app.findRecordById('studies', String(current.get('study')))
    const arm = $app.findRecordById('study_arms', String(current.get('arm')))
    const blinded = study.get('blinding') === 'arm_hidden'
    const assignedAt = String(current.get('assigned_at') || '')

    const schedule = studyLib.normalizeSchedule(study.get('schedule')).map((item) => {
      const state = studyLib.windowState(item, assignedAt, now)
      return { day: item.day, scales: item.scales, window: item.window, ...state }
    })

    // 依从概况：入组后的打卡天数、各量表完成次数
    let checkinDays = 0
    let assessmentCount = 0
    try {
      const checkins = $app.findRecordsByFilter(
        'checkins',
        'user = {:user} && created >= {:start}',
        '',
        2000,
        0,
        { user: info.auth.id, start: assignedAt }
      )
      const days = {}
      for (const row of checkins) days[String(row.get('created')).slice(0, 10)] = true
      checkinDays = Object.keys(days).length
    } catch (err) {
      checkinDays = 0
    }
    try {
      assessmentCount = $app.findRecordsByFilter(
        'assessments',
        'user = {:user} && created >= {:start}',
        '',
        200,
        0,
        { user: info.auth.id, start: assignedAt }
      ).length
    } catch (err) {
      assessmentCount = 0
    }

    return e.json(200, {
      study: {
        code: String(study.get('code')),
        title: String(study.get('title')),
        protocol_version: String(study.get('protocol_version')),
        status: String(study.get('status')),
        blinding: String(study.get('blinding') || 'none'),
      },
      enrollment: {
        status: String(current.get('status')),
        assigned_at: assignedAt,
        withdrawn_at: String(current.get('withdrawn_at') || ''),
        method: String(current.get('method') || ''),
      },
      arm: blinded
        ? { code: '', label: '已分组（本研究对受试者隐藏组别）' }
        : { code: String(arm.get('code')), label: String(arm.get('label')) },
      schedule: schedule,
      adherence: {
        checkin_days: checkinDays,
        assessments: assessmentCount,
        days_since_enroll: assignedAt
          ? Math.max(0, Math.floor((now.getTime() - new Date(assignedAt.replace(' ', 'T')).getTime()) / 86400000))
          : 0,
      },
    })
  },
  $apis.requireAuth()
)

routerAdd(
  'POST',
  '/api/zz/study/enroll',
  function (e) {
    const studyLib = require(__hooks + '/lib/study.js')
    const info = e.requestInfo()
    const body = info.body || {}
    const code = String(body.code || '').trim().toUpperCase()
    const now = new Date()

    if (!code) return e.badRequestError('请输入研究码', null)

    let study
    try {
      study = $app.findFirstRecordByFilter('studies', 'code = {:code}', { code: code })
    } catch (err) {
      return e.notFoundError('研究码无效', null)
    }
    if (study.get('status') !== 'active') {
      return e.badRequestError('该研究当前不接受入组', null)
    }
    if (!studyLib.isOpen(study, now)) {
      return e.badRequestError('不在入组时间内', null)
    }

    // 已入组直接返回现状（幂等）
    const existing = $app.findRecordsByFilter(
      'study_enrollments',
      'user = {:user} && study = {:study}',
      '',
      1,
      0,
      { user: info.auth.id, study: study.id }
    )
    if (existing.length > 0) {
      return e.json(200, { enrolled: true, already: true })
    }

    const arms = $app.findRecordsByFilter('study_arms', 'study = {:study}', 'code', 20, 0, {
      study: study.id,
    })
    if (arms.length === 0) {
      return e.badRequestError('研究尚未配置分组，请联系研究负责人', null)
    }

    const counts = {}
    for (const arm of arms) counts[arm.id] = 0
    try {
      const all = $app.findRecordsByFilter('study_enrollments', 'study = {:study}', '', 2000, 0, {
        study: study.id,
      })
      for (const row of all) {
        const armId = String(row.get('arm'))
        if (counts[armId] !== undefined) counts[armId] += 1
      }
    } catch (err) {
      // 计数失败时按空计数分配，仍可入组但记录偏差
    }

    const arm = studyLib.pickArm(
      arms.map((row) => ({
        id: row.id,
        code: String(row.get('code')),
        label: String(row.get('label')),
        ratio: Number(row.get('ratio')) || 1,
      })),
      counts
    )
    if (!arm) return e.badRequestError('分组配置无效（配比全为 0）', null)

    let enrollment
    try {
      enrollment = new Record($app.findCollectionByNameOrId('study_enrollments'))
      enrollment.set('user', info.auth.id)
      enrollment.set('study', study.id)
      enrollment.set('arm', arm.id)
      enrollment.set('assigned_at', studyLib.pbTime(now))
      enrollment.set('method', 'block')
      enrollment.set('status', 'active')
      $app.save(enrollment)
    } catch (err) {
      $app.logger().error('入组失败', 'error', String(err))
      return e.json(500, { message: '入组暂时没有完成，请稍后再试' })
    }

    try {
      const event = new Record($app.findCollectionByNameOrId('study_events'))
      event.set('study', study.id)
      event.set('user', info.auth.id)
      event.set('type', 'enrolled')
      event.set('actor', String(info.auth.get('email') || info.auth.id))
      event.set('detail', { arm: arm.code, method: 'block', counts: counts })
      $app.save(event)
    } catch (err) {
      $app.logger().warn('入组事件写入失败', 'error', String(err))
    }

    return e.json(200, { enrolled: true, already: false })
  },
  $apis.requireAuth()
)

routerAdd(
  'POST',
  '/api/zz/study/withdraw',
  function (e) {
    const info = e.requestInfo()
    const body = info.body || {}
    const reason = String(body.reason || '').trim().slice(0, 200)
    const now = new Date().toISOString().replace('T', ' ')

    const rows = $app.findRecordsByFilter(
      'study_enrollments',
      'user = {:user} && status = "active"',
      '-created',
      1,
      0,
      { user: info.auth.id }
    )
    if (rows.length === 0) {
      return e.notFoundError('没有进行中的研究参与', null)
    }

    const enrollment = rows[0]
    try {
      enrollment.set('status', 'withdrawn')
      enrollment.set('withdrawn_at', now)
      if (reason) enrollment.set('reason', reason)
      $app.save(enrollment)

      const event = new Record($app.findCollectionByNameOrId('study_events'))
      event.set('study', String(enrollment.get('study')))
      event.set('user', info.auth.id)
      event.set('type', 'withdrawn')
      event.set('actor', String(info.auth.get('email') || info.auth.id))
      event.set('detail', { reason: reason })
      $app.save(event)
    } catch (err) {
      $app.logger().error('退出研究失败', 'error', String(err))
      return e.json(500, { message: '退出没有完成，请稍后再试' })
    }

    return e.json(200, { withdrawn: true })
  },
  $apis.requireAuth()
)

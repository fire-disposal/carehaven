// 运营台：无构建的静态页面，直接调用 PocketBase REST 与 /api/zz/admin/*
// 认证沿用超管账号；token 存 sessionStorage，关闭标签页即失效。

const TOKEN_KEY = 'zz_admin_token'
const root = document.getElementById('app')

let token = sessionStorage.getItem(TOKEN_KEY) || ''

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])

const fmtTime = (raw) => {
  if (!raw) return '—'
  const d = new Date(String(raw).includes(' ') ? String(raw).replace(' ', 'T') : raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toast(message) {
  let el = document.querySelector('.toast')
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = message
  el.classList.add('show')
  clearTimeout(el._timer)
  el._timer = setTimeout(() => el.classList.remove('show'), 2200)
}

function logout() {
  token = ''
  sessionStorage.removeItem(TOKEN_KEY)
  location.hash = '#/login'
  render()
}

async function api(path, options = {}) {
  const headers = {}
  if (token) headers.Authorization = token
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (res.status === 401) {
    logout()
    throw new Error('登录已过期')
  }
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (err) {
    data = null
  }
  if (!res.ok) {
    const message = (data && data.message) || `请求失败（${res.status}）`
    throw new Error(message)
  }
  return data
}

// ---------------- 登录 ----------------

function renderLogin(message = '') {
  root.innerHTML = `
    <div class="login-wrap">
      <form class="login" id="login-form">
        <div class="brand">
          <div class="seal">忆</div>
          <div class="brand-text"><strong>智护忆站 · 运营台</strong><span>ADMIN</span></div>
        </div>
        <p>使用超级管理员账号登录。仅限受权人员使用。</p>
        <div class="field"><label>邮箱</label><input id="login-email" type="email" autocomplete="username" required /></div>
        <div class="field"><label>密码</label><input id="login-password" type="password" autocomplete="current-password" required /></div>
        <div class="error" id="login-error">${esc(message)}</div>
        <button type="submit" style="width:100%">登录</button>
      </form>
    </div>`
  const form = document.getElementById('login-form')
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const email = document.getElementById('login-email').value.trim()
    const password = document.getElementById('login-password').value
    try {
      const res = await fetch('/api/collections/_superusers/auth-with-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || '登录失败')
      token = data.token
      sessionStorage.setItem(TOKEN_KEY, token)
      location.hash = '#/overview'
      render()
    } catch (err) {
      document.getElementById('login-error').textContent = err.message
    }
  })
}

// ---------------- 框架 ----------------

function shell(active, title, subtitle, content) {
  const nav = [
    ['overview', '概览'],
    ['agent', '助手'],
    ['studies', '研究'],
    ['moderation', '内容处置'],
    ['config', '配置'],
    ['data', '数据'],
  ]
  root.innerHTML = `
    <div class="shell">
      <aside class="side">
        <div class="brand">
          <div class="seal">忆</div>
          <div class="brand-text"><strong>运营台</strong><span>CAREHAVEN</span></div>
        </div>
        <nav class="nav">
          ${nav.map(([key, label]) => `<a href="#/${key}" class="${key === active ? 'on' : ''}">${label}</a>`).join('')}
        </nav>
        <div class="side-foot">
          <a href="/" target="_blank" rel="noopener">打开应用 ↗</a><br />
          <a href="/_/" target="_blank" rel="noopener">PocketBase 后台 ↗</a><br />
          <a href="#" id="logout">退出登录</a>
        </div>
      </aside>
      <main class="main">
        <div class="topline"><h1>${esc(title)}</h1><span class="muted">${esc(subtitle || '')}</span></div>
        ${subtitle ? '' : '<div style="height:12px"></div>'}
        ${content}
      </main>
    </div>`
  document.getElementById('logout').addEventListener('click', (event) => {
    event.preventDefault()
    logout()
  })
}

// ---------------- 概览 ----------------

async function pageOverview() {
  shell('overview', '概览', '加载中…', '<div class="empty">读取中…</div>')
  try {
    const data = await api('/api/zz/admin/overview')
    const metric = (label, value, hint = '') => `
      <div class="metric"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`
    const content = `
      <div class="grid">
        ${metric('今日打卡', data.today.checkins)}
        ${metric('今日生理', data.today.physio)}
        ${metric('今日量表', data.today.assessments)}
        ${metric('今日评分', data.today.scores)}
        ${metric('待处置举报', data.pending.reported, '举报未隐藏')}
        ${metric('已隐藏内容', data.pending.hidden)}
        ${metric('今日问答调用', data.quota.ask)}
        ${metric('今日朗读调用', data.quota.tts)}
        ${metric('进行中研究', data.studies.active, `在组 ${data.studies.enrolled_active} 人`)}
        ${metric('用户总数', data.users)}
      </div>
      <h2>需要处理</h2>
      <div class="card">
        ${data.pending.reported + data.pending.hidden > 0 ? `<p>有 <strong>${data.pending.reported + data.pending.hidden}</strong> 条内容需要复核。<a href="#/moderation">去处理 →</a></p>` : '<p class="muted">当前没有待处理内容。</p>'}
        <p class="muted">研究分组与入组情况见 <a href="#/studies">研究</a>；配额与权重见 <a href="#/config">配置</a>。</p>
      </div>
      <p class="muted">生成时间：${esc(fmtTime(data.generated_at))}</p>`
    shell('overview', '概览', `生成于 ${fmtTime(data.generated_at)}`, content)
  } catch (err) {
    shell('overview', '概览', '', `<div class="card error">${esc(err.message)}</div>`)
  }
}

// ---------------- 助手 ----------------

async function pageAgent() {
  shell('agent', '助手', '加载中…', '<div class="empty">读取中…</div>')
  try {
    const data = await api('/api/zz/admin/agent/usage?days=7')
    const metric = (label, value, hint = '') => `
      <div class="metric"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`

    const dayRows = (data.days || [])
      .map(
        (row) => `<tr>
          <td class="mono">${esc(row.date)}</td>
          <td>${esc(row.requests)}</td>
          <td>${esc(row.tokens_in)} / ${esc(row.tokens_out)}</td>
          <td>¥${esc(Number(row.cost).toFixed(4))}</td>
        </tr>`
      )
      .join('')

    const userRows = (data.top_users || [])
      .map(
        (row) => `<tr>
          <td class="mono">${esc(row.label)}</td>
          <td>${esc(row.requests)}</td>
          <td>${esc(row.tokens)}</td>
          <td>¥${esc(Number(row.cost).toFixed(4))}</td>
        </tr>`
      )
      .join('')

    const content = `
      <div class="grid">
        ${metric('引擎', data.enabled ? '可用' : '未启用', data.key_configured ? `密钥已配置 · ${data.model}` : '缺少 DEEPSEEK_API_KEY')}
        ${metric('今日调用', data.today.requests, `上限 ${data.limits.requests_per_day} 次/人/日`)}
        ${metric('今日 token', data.today.tokens, `单人上限 ${data.limits.tokens_per_day}`)}
        ${metric('今日估算费用', `¥${Number(data.today.cost).toFixed(4)}`, `单人预算 ¥${data.limits.budget_yuan_per_day}/日`)}
        ${metric('全站 token 上限', data.limits.global_tokens_per_day, '防止单用户耗尽总资源')}
        ${metric('官方 tokenizer', data.tokenizer && data.tokenizer.ok ? '在线' : '不可用', data.tokenizer && data.tokenizer.ok ? `词表 ${data.tokenizer.vocab}` : (data.tokenizer && data.tokenizer.reason) || '未配置')}
      </div>

      <h2>近 7 天用量</h2>
      <div class="card">
        <table>
          <thead><tr><th>日期</th><th>调用</th><th>输入 / 输出 token</th><th>估算费用</th></tr></thead>
          <tbody>${dayRows || '<tr><td colspan="4" class="empty">还没有助手使用记录。</td></tr>'}</tbody>
        </table>
      </div>

      <h2>今日用量最高的用户</h2>
      <div class="card">
        <table>
          <thead><tr><th>用户</th><th>调用</th><th>token</th><th>估算费用</th></tr></thead>
          <tbody>${userRows || '<tr><td colspan="4" class="empty">今天还没有人使用助手。</td></tr>'}</tbody>
        </table>
        <p class="muted">邮箱只显示前缀；费用按 <span class="mono">agent_pricing</span> 估算，不是账单。</p>
      </div>

      <h2>配额与密钥</h2>
      <div class="card">
        <p>配额（请求数 / token / 费用 / 全站 token）在 <a href="#/config">配置 · agent_limits</a> 中修改；计价在 <span class="mono">agent_pricing</span>。</p>
        <p>密钥只从服务端环境变量读取：<span class="mono">DEEPSEEK_API_KEY</span>、<span class="mono">DEEPSEEK_MODEL</span>（默认 deepseek-flash）、<span class="mono">DEEPSEEK_BASE_URL</span>（默认官方地址）。轮换方式：改服务器 <span class="mono">/srv/carehaven/.env</span> 后重启容器。</p>
        <p class="muted">助手只在服务端调用模型；客户端不接触密钥，也不能执行工具。</p>
      </div>`

    shell('agent', '助手', data.enabled ? '可用' : '未启用', content)
  } catch (err) {
    shell('agent', '助手', '', `<div class="card error">${esc(err.message)}</div>`)
  }
}

// ---------------- 研究 ----------------

let studyForm = { schedule: [{ day: 0, scales: 'phq9,gad7,zbi12', window: 3 }], arms: [{ code: 'A', label: 'A 组', ratio: 1 }, { code: 'B', label: 'B 组', ratio: 1 }] }

async function pageStudies() {
  shell('studies', '研究', '加载中…', '<div class="empty">读取中…</div>')
  try {
    const list = await api('/api/collections/studies/records?perPage=50&sort=-created')
    const rows = (list.items || [])
      .map(
        (s) => `<tr>
          <td class="mono">${esc(s.code)}</td>
          <td>${esc(s.title)}<div class="muted">协议 ${esc(s.protocol_version)} · ${esc(s.blinding === 'arm_hidden' ? '受试者盲法' : '开放分组')}</div></td>
          <td><span class="badge ${s.status === 'active' ? 'green' : s.status === 'closed' ? 'red' : 'yellow'}">${esc(s.status)}</span></td>
          <td>${esc(fmtTime(s.created))}</td>
          <td><a href="#/study/${esc(s.id)}">详情</a></td>
        </tr>`
      )
      .join('')

    const content = `
      <div class="card">
        <table>
          <thead><tr><th>研究码</th><th>名称</th><th>状态</th><th>创建</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="empty">还没有研究。</td></tr>'}</tbody>
        </table>
      </div>
      <h2>新建研究</h2>
      <form class="card" id="study-form">
        <div class="row">
          <div class="field"><label>研究码</label><input name="code" placeholder="PILOT01" required /></div>
          <div class="field" style="flex:2"><label>研究名称</label><input name="title" placeholder="照护者压力分层干预可行性研究" required /></div>
          <div class="field"><label>协议版本</label><input name="protocol_version" value="1.0" /></div>
        </div>
        <div class="row">
          <div class="field"><label>分组可见性</label>
            <select name="blinding"><option value="arm_hidden">受试者盲法（只显示已分组）</option><option value="none">开放分组</option></select>
          </div>
          <div class="field"><label>开放时间（可选）</label><input name="opens_at" placeholder="2026-11-10 00:00:00" /></div>
          <div class="field"><label>关闭时间（可选）</label><input name="closes_at" placeholder="2027-03-01 00:00:00" /></div>
        </div>
        <label>评估时间点（相对入组日）</label>
        <div id="schedule-rows"></div>
        <button type="button" class="ghost small" id="add-schedule">+ 添加时间点</button>
        <label style="margin-top:16px">分组与配比</label>
        <div id="arm-rows"></div>
        <button type="button" class="ghost small" id="add-arm">+ 添加分组</button>
        <div class="error" id="study-error" style="margin-top:12px"></div>
        <div style="margin-top:12px"><button type="submit">创建研究（草稿）</button></div>
      </form>`

    shell('studies', '研究', `${list.totalItems || 0} 个`, content)
    renderStudyForm()
    document.getElementById('add-schedule').addEventListener('click', () => {
      studyForm.schedule.push({ day: 14, scales: 'phq9', window: 2 })
      renderStudyForm()
    })
    document.getElementById('add-arm').addEventListener('click', () => {
      studyForm.arms.push({ code: '', label: '', ratio: 1 })
      renderStudyForm()
    })
    document.getElementById('study-form').addEventListener('submit', async (event) => {
      event.preventDefault()
      const form = event.target
      const payload = {
        code: form.code.value,
        title: form.title.value,
        protocol_version: form.protocol_version.value,
        blinding: form.blinding.value,
        opens_at: form.opens_at.value || '',
        closes_at: form.closes_at.value || '',
        schedule: studyForm.schedule.map((row) => ({
          day: Number(row.day),
          window: Number(row.window),
          scales: String(row.scales)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        })),
        arms: studyForm.arms.map((row) => ({ code: row.code, label: row.label, ratio: Number(row.ratio) })),
      }
      try {
        await api('/api/zz/admin/study', { method: 'POST', body: payload })
        studyForm = { schedule: [{ day: 0, scales: 'phq9,gad7,zbi12', window: 3 }], arms: [{ code: 'A', label: 'A 组', ratio: 1 }, { code: 'B', label: 'B 组', ratio: 1 }] }
        toast('研究已创建（草稿）')
        pageStudies()
      } catch (err) {
        document.getElementById('study-error').textContent = err.message
      }
    })
  } catch (err) {
    shell('studies', '研究', '', `<div class="card error">${esc(err.message)}</div>`)
  }
}

function renderStudyForm() {
  const scheduleEl = document.getElementById('schedule-rows')
  const armEl = document.getElementById('arm-rows')
  if (!scheduleEl || !armEl) return

  scheduleEl.innerHTML = studyForm.schedule
    .map(
      (row, index) => `<div class="schedule-row">
        <input value="${esc(row.day)}" data-schedule="${index}" data-key="day" placeholder="天" />
        <input value="${esc(row.scales)}" data-schedule="${index}" data-key="scales" placeholder="phq9,gad7,zbi12" />
        <input value="${esc(row.window)}" data-schedule="${index}" data-key="window" placeholder="窗口天数" />
        <button type="button" class="danger small" data-remove-schedule="${index}">删除</button>
      </div>`
    )
    .join('')

  armEl.innerHTML = studyForm.arms
    .map(
      (row, index) => `<div class="arm-row">
        <input value="${esc(row.code)}" data-arm="${index}" data-key="code" placeholder="代号 A" />
        <input value="${esc(row.label)}" data-arm="${index}" data-key="label" placeholder="A 组（干预）" />
        <input value="${esc(row.ratio)}" data-arm="${index}" data-key="ratio" placeholder="配比" />
        <button type="button" class="danger small" data-remove-arm="${index}">删除</button>
      </div>`
    )
    .join('')

  scheduleEl.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      studyForm.schedule[Number(input.dataset.schedule)][input.dataset.key] = input.value
    })
  })
  armEl.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      studyForm.arms[Number(input.dataset.arm)][input.dataset.key] = input.value
    })
  })
  scheduleEl.querySelectorAll('[data-remove-schedule]').forEach((button) => {
    button.addEventListener('click', () => {
      studyForm.schedule.splice(Number(button.dataset.removeSchedule), 1)
      renderStudyForm()
    })
  })
  armEl.querySelectorAll('[data-remove-arm]').forEach((button) => {
    button.addEventListener('click', () => {
      studyForm.arms.splice(Number(button.dataset.removeArm), 1)
      renderStudyForm()
    })
  })
}

async function pageStudyDetail(id) {
  shell('studies', '研究详情', '加载中…', '<div class="empty">读取中…</div>')
  try {
    const data = await api(`/api/zz/admin/studies/${id}/quality`)
    const arms = data.arms
      .map(
        (arm) => `<tr>
          <td><strong>${esc(arm.code)}</strong> ${esc(arm.label)}</td>
          <td class="mono">${esc(arm.ratio)}</td>
          <td>${esc(arm.enrolled)}</td>
          <td>${esc(arm.withdrawn)}<span class="muted">（${arm.withdrawal_rate === null ? '—' : `${Math.round(arm.withdrawal_rate * 100)}%`}）</span></td>
          <td>${arm.mean_checkin_days === null ? '—' : esc(arm.mean_checkin_days)}</td>
          <td>${esc(arm.assessments)}</td>
        </tr>`
      )
      .join('')

    const statusButtons = ['draft', 'active', 'closed']
      .filter((s) => s !== data.study.status)
      .map((s) => `<button class="ghost small" data-status="${s}">切换为 ${s}</button>`)
      .join(' ')

    const content = `
      <div class="card">
        <div class="topline">
          <div><strong>${esc(data.study.title)}</strong><div class="muted">研究码 ${esc(data.study.code)} · 协议 ${esc(data.study.protocol_version)} · ${esc(data.study.blinding === 'arm_hidden' ? '受试者盲法' : '开放分组')}</div></div>
          <span class="badge ${data.study.status === 'active' ? 'green' : data.study.status === 'closed' ? 'red' : 'yellow'}">${esc(data.study.status)}</span>
        </div>
        <div style="margin-top:12px">${statusButtons}</div>
      </div>
      <h2>按臂质量</h2>
      <div class="card">
        <table>
          <thead><tr><th>分组</th><th>配比</th><th>入组</th><th>退出</th><th>人均打卡天数</th><th>量表次数</th></tr></thead>
          <tbody>${arms || '<tr><td colspan="6" class="empty">没有分组。</td></tr>'}</tbody>
        </table>
        <p class="muted" style="margin-top:10px">入组数含已退出者（ITT 口径）；人均打卡天数按入组后计算。</p>
      </div>
      <p><a href="#/studies">← 返回研究列表</a></p>`

    shell('studies', '研究详情', data.study.code, content)
    document.querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await api(`/api/zz/admin/study/${id}/status`, { method: 'POST', body: { status: button.dataset.status } })
          toast('状态已更新')
          pageStudyDetail(id)
        } catch (err) {
          toast(err.message)
        }
      })
    })
  } catch (err) {
    shell('studies', '研究详情', '', `<div class="card error">${esc(err.message)}</div>`)
  }
}

// ---------------- 内容处置 ----------------

async function pageModeration() {
  shell('moderation', '内容处置', '加载中…', '<div class="empty">读取中…</div>')
  try {
    const data = await api('/api/zz/admin/moderation/queue?limit=50')
    const rows = (data.items || [])
      .map(
        (item) => `<tr>
          <td style="max-width:420px">${esc(item.text)}
            <div class="muted">${esc(item.kind)} · ${esc(item.nickname)} · ${esc(fmtTime(item.created))}${item.hidden ? ' · 已隐藏' : ''}</div>
            <div class="muted">举报原因：${item.reasons.length ? esc(item.reasons.join(' / ')) : '未记录'}</div>
          </td>
          <td class="mono">${esc(item.report_count)}</td>
          <td>${item.hidden ? '<span class="badge red">已隐藏</span>' : `<button class="small" data-action="hide" data-id="${esc(item.id)}">隐藏</button>`}
            ${item.hidden ? `<button class="ghost small" data-action="restore" data-id="${esc(item.id)}">恢复</button>` : ''}
          </td>
        </tr>`
      )
      .join('')

    const content = `
      <div class="card">
        <table>
          <thead><tr><th>内容</th><th>举报数</th><th>处置</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3" class="empty">没有待处理内容。</td></tr>'}</tbody>
        </table>
      </div>
      <p class="muted">处置会写入 moderation_actions（操作者、理由、前后状态）。</p>`

    shell('moderation', '内容处置', `${data.items ? data.items.length : 0} 条`, content)
    document.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action
        const reason = window.prompt(action === 'hide' ? '隐藏理由（至少 4 个字）' : '恢复理由（至少 4 个字）', '')
        if (!reason || reason.trim().length < 4) return
        try {
          await api(`/api/zz/moderation/whispers/${button.dataset.id}`, {
            method: 'POST',
            body: { action, reason: reason.trim() },
          })
          toast('已记录处置')
          pageModeration()
        } catch (err) {
          toast(err.message)
        }
      })
    })
  } catch (err) {
    shell('moderation', '内容处置', '', `<div class="card error">${esc(err.message)}</div>`)
  }
}

// ---------------- 配置 ----------------

async function pageConfig() {
  shell('config', '配置', '加载中…', '<div class="empty">读取中…</div>')
  try {
    const list = await api('/api/collections/app_config/records?perPage=50&sort=key')
    const rows = (list.items || [])
      .map(
        (row) => `<div class="card" data-config="${esc(row.id)}">
          <div class="topline"><strong class="mono">${esc(row.key)}</strong><span class="muted">${esc(row.description || '')}</span></div>
          <textarea data-value="${esc(row.id)}">${esc(JSON.stringify(row.value, null, 2))}</textarea>
          <div class="row" style="margin-top:8px">
            <button class="small" data-save="${esc(row.id)}">保存</button>
            <button class="ghost small" data-history="${esc(row.key)}">查看变更历史</button>
          </div>
          <div class="muted" data-history-out="${esc(row.key)}"></div>
        </div>`
      )
      .join('')

    shell('config', '配置', `${list.totalItems || 0} 项`, `<div class="muted">数值由服务端校验（Σw=1、阈值有序、区间 lo&lt;hi），非法写入会被拒绝并记录历史。</div>${rows}`)

    document.querySelectorAll('[data-save]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.save
        const textarea = document.querySelector(`[data-value="${id}"]`)
        let value
        try {
          value = JSON.parse(textarea.value)
        } catch (err) {
          toast('JSON 格式不正确')
          return
        }
        try {
          await api(`/api/collections/app_config/records/${id}`, { method: 'PATCH', body: { value } })
          toast('已保存')
        } catch (err) {
          toast(err.message)
        }
      })
    })

    document.querySelectorAll('[data-history]').forEach((button) => {
      button.addEventListener('click', async () => {
        const key = button.dataset.history
        const out = document.querySelector(`[data-history-out="${key}"]`)
        try {
          const data = await api(
            `/api/collections/app_config_history/records?perPage=5&sort=-created&filter=${encodeURIComponent(`key = "${key}"`)}`
          )
          out.innerHTML = (data.items || [])
            .map((row) => `<div class="mono">${esc(fmtTime(row.created))} · ${esc(row.author)} · ${esc(row.reason)} · ${esc(JSON.stringify(row.value))}</div>`)
            .join('')
        } catch (err) {
          out.textContent = err.message
        }
      })
    })
  } catch (err) {
    shell('config', '配置', '', `<div class="card error">${esc(err.message)}</div>`)
  }
}

// ---------------- 数据 ----------------

async function pageData() {
  shell('data', '数据', '加载中…', '<div class="empty">读取中…</div>')
  try {
    let backups = []
    try {
      const data = await api('/api/backups')
      backups = data || []
    } catch (err) {
      backups = []
    }
    const backupRows = (Array.isArray(backups) ? backups : [])
      .slice(0, 5)
      .map((b) => `<tr><td class="mono">${esc(b.key || b.name || '')}</td><td>${esc(b.modified ? fmtTime(b.modified) : '')}</td></tr>`)
      .join('')

    const content = `
      <h2>数据集导出</h2>
      <div class="card">
        <p>导出在服务器上执行（只读打开 SQLite），产物含 CSV、质量报表与 manifest：</p>
        <pre class="mono" id="cmd">cd /srv/carehaven && docker exec carehaven sh -c 'cd /pb && RESEARCH_HMAC_SECRET=… bun research/dataset.mjs --db /pb/pb_data/data.db --out /pb/data-export'</pre>
        <button class="ghost small" data-copy="cmd">复制命令</button>
        <p class="muted">密钥需与历次导出保持一致，否则同一用户的去标识 ID 无法跨批次关联。</p>
      </div>
      <h2>评分回放</h2>
      <div class="card">
        <pre class="mono" id="cmd2">docker cp carehaven:/pb/pb_data/data.db /tmp/data.db && bun research/replay.mjs --db /tmp/data.db</pre>
        <button class="ghost small" data-copy="cmd2">复制命令</button>
      </div>
      <h2>最近备份</h2>
      <div class="card">
        <table><thead><tr><th>文件</th><th>时间</th></tr></thead><tbody>${backupRows || '<tr><td colspan="2" class="empty">读取不到备份列表。</td></tr>'}</tbody></table>
      </div>`

    shell('data', '数据', '', content)
    document.querySelectorAll('[data-copy]').forEach((button) => {
      button.addEventListener('click', async () => {
        const text = document.getElementById(button.dataset.copy).textContent
        try {
          await navigator.clipboard.writeText(text)
          toast('已复制')
        } catch (err) {
          toast('复制失败，请手动选择')
        }
      })
    })
  } catch (err) {
    shell('data', '数据', '', `<div class="card error">${esc(err.message)}</div>`)
  }
}

// ---------------- 路由 ----------------

function render() {
  const hash = location.hash.replace(/^#\/?/, '')
  if (!token) {
    renderLogin()
    return
  }
  const [page, param] = hash.split('/')
  if (page === 'agent') return pageAgent()
  if (page === 'studies') return pageStudies()
  if (page === 'study' && param) return pageStudyDetail(param)
  if (page === 'moderation') return pageModeration()
  if (page === 'config') return pageConfig()
  if (page === 'data') return pageData()
  return pageOverview()
}

window.addEventListener('hashchange', render)
render()

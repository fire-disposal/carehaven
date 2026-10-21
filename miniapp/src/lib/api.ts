import Taro from '@tarojs/taro'

// ---------------------------------------------------------------------------
// 数据访问层：小程序端唯一的后端出入口。
// 后端为 PocketBase，接口是标准 REST；这里不做任何「演示模式」旁路，
// 登录态只能由真实登录流程写入。
// ---------------------------------------------------------------------------

const BASE = process.env.TARO_APP_API_BASE || '' // 留空 = 与页面同源（H5 产物由 PB 托管时）
const TOKEN_KEY = 'zz_token'
const USER_KEY = 'zz_user'

export interface User {
  id: string
  email: string
  name?: string
  avatar?: string
  /** 微信 openid（绑定后存在；H5 端通常为空） */
  wechat_openid?: string
}

// ---------------- 会话 ----------------

export function getToken(): string {
  return Taro.getStorageSync(TOKEN_KEY) || ''
}

export function getUser(): User | null {
  const raw = Taro.getStorageSync(USER_KEY)
  return raw ? (raw as User) : null
}

export function setSession(token: string, user: User) {
  Taro.setStorageSync(TOKEN_KEY, token)
  Taro.setStorageSync(USER_KEY, user)
}

export function clearSession() {
  Taro.removeStorageSync(TOKEN_KEY)
  Taro.removeStorageSync(USER_KEY)
}

export function isLoggedIn(): boolean {
  return !!getToken()
}

// ---------------- 基础请求 ----------------

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface RequestOptions {
  method?: Method
  data?: Record<string, unknown>
  query?: Record<string, string | number | undefined>
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** PocketBase 的错误响应体：{ message, data: { field: "错误说明" } } */
function readErrorPayload(payload: unknown): { message?: string; detail?: string } {
  if (!payload || typeof payload !== 'object') return {}
  const body = payload as { message?: unknown; data?: unknown }
  const message = typeof body.message === 'string' ? body.message : undefined
  let detail: string | undefined
  if (body.data && typeof body.data === 'object') {
    const parts = Object.values(body.data as Record<string, unknown>).filter(
      (v): v is string => typeof v === 'string'
    )
    detail = parts.length ? parts.join('；') : undefined
  }
  return { message, detail }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const qs = opts.query
    ? Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : ''
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`
  const token = getToken()

  const res = await Taro.request({
    url,
    method: opts.method || 'GET',
    data: opts.data,
    header: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
  })

  if (res.statusCode === 401 || res.statusCode === 403) {
    clearSession()
    throw new ApiError('登录已过期，请重新登录', res.statusCode)
  }
  if (res.statusCode >= 400) {
    const { message, detail } = readErrorPayload(res.data)
    const suffix = detail ? `（${detail}）` : ''
    throw new ApiError(message ? `${message}${suffix}` : `请求失败（${res.statusCode}）`, res.statusCode)
  }
  // Taro 把响应体声明为 any（跨端统一类型的固有代价），此处按调用方约定的 T 消费
  return res.data as T
}

// ---------------- 集合通用方法 ----------------

interface ListResult<T> {
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  items: T[]
}

function list<T>(
  collection: string,
  query: Record<string, string | number | undefined> = {}
): Promise<ListResult<T>> {
  return request<ListResult<T>>(`/api/collections/${collection}/records`, { query })
}

function create<T>(collection: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/api/collections/${collection}/records`, { method: 'POST', data })
}

function update<T>(collection: string, id: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/api/collections/${collection}/records/${id}`, { method: 'PATCH', data })
}

function remove(collection: string, id: string): Promise<void> {
  return request<void>(`/api/collections/${collection}/records/${id}`, { method: 'DELETE' })
}

// ---------------- 鉴权 ----------------

export interface AuthResult {
  token: string
  record: User
}

export async function login(identity: string, password: string): Promise<User> {
  const res = await request<AuthResult>('/api/collections/users/auth-with-password', {
    method: 'POST',
    data: { identity, password },
  })
  setSession(res.token, res.record)
  return res.record
}

export async function register(email: string, password: string, name: string): Promise<User> {
  await create<User>('users', {
    email,
    password,
    passwordConfirm: password,
    name,
  })
  return login(email, password)
}

export function logout() {
  clearSession()
  Taro.reLaunch({ url: '/pages/login/index' })
}

/**
 * 微信一键登录（仅小程序端）：用 `Taro.login()` 的 code 换本系统会话。
 * 网页端拿不到微信登录凭证，因此 H5 界面不展示该入口。
 */
export async function wechatLogin(code: string): Promise<User> {
  const res = await request<AuthResult>('/api/zz/wechat/login', {
    method: 'POST',
    data: { code },
  })
  setSession(res.token, res.record)
  return res.record
}

/**
 * 把微信绑定到当前登录账号（仅小程序端）。
 * 用于跨端同账号：先用邮箱登录，再绑定微信，之后两端指向同一条 users 记录。
 */
export async function wechatBind(code: string): Promise<User> {
  const res = await request<{ record: User }>('/api/zz/wechat/bind', {
    method: 'POST',
    data: { code },
  })
  // token 不变，但用户记录多了 openid，刷新本地会话以便界面立即反映绑定状态
  setSession(getToken(), res.record)
  return res.record
}

// ---------------- 领域类型 ----------------

export type Level = 'green' | 'yellow' | 'red'

export interface StressScore {
  id: string
  date: string
  hps: number
  level: Level
  score_physio: number
  score_psycho: number
  score_context: number
  advice: string
}

/** 一次量表自评；分数与分级由服务端返回，客户端不自行计算后覆盖 */
export interface AssessmentRecord {
  id?: string
  scale: 'zbi12' | 'phq9' | 'gad7'
  scaleName?: string
  score: number
  maxScore?: number
  severity: string
  level: Level
  advice?: string
  flag?: boolean
  answers?: number[]
  created: string
}

export interface PhysioRecord {
  id: string
  date: string
  hrv: number
  gsr: number
  sleep_quality: number
  steps: number
  source: 'device' | 'simulated' | 'manual'
}

export interface Checkin {
  id: string
  date: string
  period: 'morning' | 'evening'
  mood: number
  anxiety: number
  fatigue: number
  sleep_hours: number
  care_hours: number
  note: string
  created?: string
}

export interface Intervention {
  id: string
  title: string
  category: '呼吸放松' | '冥想练习' | '音乐疗法' | '视频指导'
  level_target: Level
  duration_min: number
  description: string
  cover_emoji: string
  sort: number
}

export interface InterventionLog {
  id: string
  title_snapshot: string
  completed_at: string
  duration_actual: number
  feeling: number
  expand?: { intervention?: Intervention }
}

export interface KbEntry {
  id: string
  title: string
  category: string
  keywords: string
  content: string
  source: string
}

export interface Post {
  id: string
  nickname: string
  section: '经验分享' | '情绪树洞' | '照护技巧'
  content: string
  anonymous: boolean
  likes: number
  comments_count: number
  created: string
}

export interface Comment {
  id: string
  post: string
  nickname: string
  content: string
  anonymous: boolean
  created: string
}

export interface Rating {
  id: string
  target: 'intervention' | 'app'
  target_id: string
  stars: number
  comment: string
  created: string
}

export interface AskResult {
  answer: string
  sources: { id: string; title: string; category: string }[]
}

export interface QaSession {
  id: string
  question: string
  answer: string
  created: string
}

export type FeedbackCategory = '功能建议' | '使用困难' | '内容问题' | '违规举报' | '其他'

export interface FeedbackInput {
  category: FeedbackCategory
  content: string
  contact?: string
  page?: string
}

export interface TtsResult {
  chunks: string[]
  contentType: string
  chars: number
}

// ---------------- 领域方法 ----------------

function todayRange() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${day} 00:00:00.000Z`
}

export const api = {
  // 压力评估结果
  async latestScore(): Promise<StressScore | null> {
    const res = await list<StressScore>('stress_scores', { sort: '-date', perPage: 1 })
    return res.items[0] || null
  },

  async scores(days = 30): Promise<StressScore[]> {
    const res = await list<StressScore>('stress_scores', { sort: 'date', perPage: days })
    return res.items
  },

  /** 读取系统配置（HPS 权重、三色阈值等），value 为 JSON 字段 */
  async appConfig<T>(key: string, fallback: T): Promise<T> {
    const res = await list<{ id: string; key: string; value: T; description: string }>('app_config', {
      filter: `key = "${key}"`,
      perPage: 1,
    })
    const row = res.items[0]
    return row && row.value !== undefined && row.value !== null ? row.value : fallback
  },

  // 生理数据
  async latestPhysio(): Promise<PhysioRecord | null> {
    const res = await list<PhysioRecord>('physio_records', { sort: '-date', perPage: 1 })
    return res.items[0] || null
  },

  /** 写入一条生理数据：手动录入或蓝牙设备同步（source 决定来源标注） */
  createPhysioRecord(data: {
    hrv: number
    gsr: number
    sleep_quality: number
    steps: number
    source: PhysioRecord['source']
    measuredAt?: string
  }): Promise<PhysioRecord> {
    const user = getUser()
    return create<PhysioRecord>('physio_records', {
      user: user?.id,
      date: data.measuredAt || new Date().toISOString().replace('T', ' '),
      hrv: data.hrv,
      gsr: data.gsr,
      sleep_quality: data.sleep_quality,
      steps: data.steps,
      source: data.source,
    })
  },

  // 打卡
  async todayCheckins(): Promise<Checkin[]> {
    const res = await list<Checkin>('checkins', {
      filter: `date >= "${todayRange()}"`,
      sort: '-date',
    })
    return res.items
  },

  async recentCheckins(days = 14): Promise<Checkin[]> {
    const res = await list<Checkin>('checkins', { sort: '-date', perPage: days * 2 })
    return res.items
  },

  createCheckin(data: {
    period: 'morning' | 'evening'
    mood: number
    anxiety: number
    fatigue: number
    sleep_hours: number
    care_hours: number
    note?: string
  }): Promise<Checkin> {
    const user = getUser()
    return create<Checkin>('checkins', {
      ...data,
      note: data.note || '',
      user: user?.id,
      date: new Date().toISOString().replace('T', ' '),
    })
  },

  // 减压方案
  async interventions(level?: Level): Promise<Intervention[]> {
    const res = await list<Intervention>('interventions', {
      filter: level ? `level_target = "${level}"` : '',
      sort: 'sort',
      perPage: 50,
    })
    return res.items
  },

  logIntervention(data: {
    intervention: Intervention
    duration_actual: number
    feeling: number
    note?: string
  }): Promise<InterventionLog> {
    const user = getUser()
    return create<InterventionLog>('intervention_logs', {
      user: user?.id,
      intervention: data.intervention.id,
      title_snapshot: data.intervention.title,
      completed_at: new Date().toISOString().replace('T', ' '),
      duration_actual: data.duration_actual,
      feeling: data.feeling,
      note: data.note || '',
    })
  },

  async interventionLogs(limit = 30): Promise<InterventionLog[]> {
    const res = await list<InterventionLog>('intervention_logs', {
      sort: '-completed_at',
      perPage: limit,
    })
    return res.items
  },

  // 知识库与问答
  async knowledge(): Promise<KbEntry[]> {
    const res = await list<KbEntry>('kb_entries', { sort: 'category', perPage: 100 })
    return res.items
  },

  ask(question: string): Promise<AskResult> {
    return request<AskResult>('/api/zz/ask', { method: 'POST', data: { question } })
  },

  // 量表自评（服务端计分）
  submitAssessment(
    scale: AssessmentRecord['scale'],
    answers: number[]
  ): Promise<AssessmentRecord> {
    return request<AssessmentRecord>('/api/zz/assessments', {
      method: 'POST',
      data: { scale, answers },
    })
  },

  async assessments(limit = 20): Promise<AssessmentRecord[]> {
    const res = await list<AssessmentRecord>('assessments', {
      sort: '-created',
      perPage: limit,
    })
    return res.items
  },

  submitFeedback(data: FeedbackInput): Promise<{ id: string; created: string }> {
    return request<{ id: string; created: string }>('/api/zz/feedback', {
      method: 'POST',
      data: {
        category: data.category,
        content: data.content,
        contact: data.contact || '',
        page: data.page || '',
      },
    })
  },

  // 语音合成（服务端代理，密钥不下发客户端）
  ttsStatus(): Promise<{ available: boolean }> {
    return request<{ available: boolean }>('/api/zz/tts/status')
  },

  tts(text: string): Promise<TtsResult> {
    return request<TtsResult>('/api/zz/tts', { method: 'POST', data: { text } })
  },

  async qaHistory(limit = 20): Promise<QaSession[]> {
    const res = await list<QaSession>('qa_sessions', { sort: '-created', perPage: limit })
    return res.items
  },

  // 社群
  async posts(section?: string): Promise<Post[]> {
    const res = await list<Post>('posts', {
      filter: section ? `section = "${section}"` : '',
      sort: '-created',
      perPage: 50,
    })
    return res.items
  },

  createPost(data: {
    section: Post['section']
    content: string
    anonymous: boolean
    nickname: string
  }): Promise<Post> {
    const user = getUser()
    const display = data.anonymous ? '匿名' : data.nickname || user?.name || '照护者'
    return create<Post>('posts', {
      user: user?.id,
      nickname: display,
      section: data.section,
      content: data.content,
      anonymous: data.anonymous,
      likes: 0,
      comments_count: 0,
    })
  },

  /**
   * 点赞：由服务端路由自增计数。
   * 不能直接 PATCH posts —— 该表的 updateRule 只允许作者修改自己的帖子。
   */
  likePost(postId: string): Promise<{ likes: number }> {
    return request<{ likes: number }>(`/api/zz/posts/${postId}/like`, { method: 'POST' })
  },

  async comments(postId: string): Promise<Comment[]> {
    const res = await list<Comment>('comments', {
      filter: `post = "${postId}"`,
      sort: 'created',
      perPage: 100,
    })
    return res.items
  },

  createComment(data: {
    postId: string
    content: string
    anonymous: boolean
  }): Promise<Comment> {
    const user = getUser()
    return create<Comment>('comments', {
      post: data.postId,
      user: user?.id,
      nickname: data.anonymous ? '匿名' : user?.name || '照护者',
      content: data.content,
      anonymous: data.anonymous,
    })
  },

  // 反馈
  async ratings(): Promise<Rating[]> {
    const res = await list<Rating>('ratings', { sort: '-created', perPage: 50 })
    return res.items
  },

  createRating(data: { target: Rating['target']; target_id?: string; stars: number; comment?: string }): Promise<Rating> {
    const user = getUser()
    return create<Rating>('ratings', {
      user: user?.id,
      target: data.target,
      target_id: data.target_id || '',
      stars: data.stars,
      comment: data.comment || '',
    })
  },
}

export { request, list, create, update, remove }

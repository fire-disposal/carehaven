// 微信小程序登录（jscode2session → 绑定 openid → 签发 PocketBase token）
//
// 为什么放在 hooks 里而不是独立服务：这是「把外部身份映射到本地用户」的一步，
// 没有长耗时、没有队列需求；等问答接 LLM（长请求）时才需要另起网关。
//
// 需要的环境变量（放服务器 /srv/carehaven/.env，不进 git）：
//   WECHAT_APP_ID / WECHAT_APP_SECRET
// 未配置时接口返回 503 并给出明确原因，不会静默失败。

function configError() {
  const missing = []
  if (!$os.getenv('WECHAT_APP_ID')) missing.push('WECHAT_APP_ID')
  if (!$os.getenv('WECHAT_APP_SECRET')) missing.push('WECHAT_APP_SECRET')
  return missing
}

/** 用登录凭证 code 换 openid（微信官方接口） */
function exchangeCode(code) {
  const appid = $os.getenv('WECHAT_APP_ID')
  const secret = $os.getenv('WECHAT_APP_SECRET')
  const url =
    'https://api.weixin.qq.com/sns/jscode2session' +
    '?appid=' + encodeURIComponent(appid) +
    '&secret=' + encodeURIComponent(secret) +
    '&js_code=' + encodeURIComponent(code) +
    '&grant_type=authorization_code'

  const res = $http.send({ url: url, method: 'GET', timeout: 15 })
  if (res.statusCode !== 200) {
    throw new Error('微信接口不可用（HTTP ' + res.statusCode + '）')
  }
  const data = res.json || {}
  if (data.errcode) {
    throw new Error('微信登录失败：' + (data.errmsg || String(data.errcode)))
  }
  if (!data.openid) {
    throw new Error('微信未返回 openid')
  }
  return data
}

function findByOpenid(openid) {
  try {
    return $app.findFirstRecordByFilter('users', 'wechat_openid = {:openid}', { openid: openid })
  } catch (err) {
    return null
  }
}

/**
 * 登录或注册：openid 命中则复用同一条 users 记录，
 * 否则新建（邮箱用确定性的占位地址满足 users 集合的唯一约束，便于日后补绑真实邮箱）。
 */
function findOrCreateUser(openid, unionid) {
  const existing = findByOpenid(openid)
  if (existing) {
    if (unionid && !existing.get('wechat_unionid')) {
      existing.set('wechat_unionid', unionid)
      $app.save(existing)
    }
    return existing
  }

  const user = new Record($app.findCollectionByNameOrId('users'))
  user.set('wechat_openid', openid)
  if (unionid) user.set('wechat_unionid', unionid)
  user.set('email', openid + '@wechat.local')
  user.set('name', '照护者')
  user.set('verified', true) // 微信身份即已验证
  $app.save(user)
  return user
}

function loginWithCode(code) {
  if (!code) {
    throw new Error('缺少微信登录凭证 code')
  }
  const session = exchangeCode(code)
  const user = findOrCreateUser(session.openid, session.unionid)
  return {
    token: user.newAuthToken(),
    record: user,
  }
}

/**
 * 把微信身份绑定到「当前已登录账号」。
 * 用于跨端同账号：先用邮箱登录（H5 或小程序），再在小程序里绑定微信，
 * 之后两端都指向同一条 users 记录。
 * 若该 openid 已属于别的账号，拒绝绑定并提示直接用它登录——避免悄悄把两个账号合并。
 */
function bindWithCode(userId, code) {
  if (!userId) {
    throw new Error('缺少当前登录账号')
  }
  if (!code) {
    throw new Error('缺少微信登录凭证 code')
  }

  const session = exchangeCode(code)
  const owner = findByOpenid(session.openid)
  if (owner && owner.id !== userId) {
    throw new Error('该微信已绑定到其他账号，请直接使用微信登录')
  }

  const user = $app.findRecordById('users', userId)
  user.set('wechat_openid', session.openid)
  if (session.unionid) {
    user.set('wechat_unionid', session.unionid)
  }
  if (!user.get('verified')) {
    user.set('verified', true)
  }
  $app.save(user)
  return user
}

module.exports = {
  loginWithCode: loginWithCode,
  bindWithCode: bindWithCode,
  missingEnv: configError,
}

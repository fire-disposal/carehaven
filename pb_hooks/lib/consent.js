// 研究同意的条款版本与判定
//
// hook 处理器在独立运行时执行，读不到 .pb.js 顶层的常量，所以版本号放这里。

const CONSENT_VERSION = '2026-11-1'

function isGranted(row) {
  if (!row) return false
  const grantedAt = String(row.get('granted_at') || '')
  const withdrawnAt = String(row.get('withdrawn_at') || '')
  return grantedAt !== '' && withdrawnAt === ''
}

module.exports = { CONSENT_VERSION: CONSENT_VERSION, isGranted: isGranted }

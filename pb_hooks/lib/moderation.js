// 处置留痕
//
// 谁在什么时候把哪条内容隐藏/恢复了、依据是什么——这是运营被问到时唯一能拿出的东西。
// 全部写入 moderation_actions；只对管理员可见。

function recordAction(params) {
  const record = new Record($app.findCollectionByNameOrId('moderation_actions'))
  record.set('actor', String(params.actor || 'admin'))
  record.set('target_collection', String(params.collection || ''))
  record.set('target_id', String(params.id || ''))
  record.set('action', params.action === 'restored' ? 'restored' : 'hidden')
  record.set('reason', String(params.reason || ''))
  if (params.before !== undefined) record.set('before', params.before)
  if (params.after !== undefined) record.set('after', params.after)
  $app.save(record)
  return record
}

module.exports = { recordAction: recordAction }

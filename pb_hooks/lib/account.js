// 账号导出：集合清单与序列化
//
// hook 处理器运行在独立运行时，读不到 hook 文件顶层的常量/函数，
// 因此清单与序列化都放在这里，由处理器内部 require。

const EXPORT_COLLECTIONS = [
  'checkins',
  'physio_records',
  'stress_scores',
  'stress_score_events',
  'assessments',
  'intervention_logs',
  'ratings',
  'qa_sessions',
  'whispers',
  'whisper_reactions',
  'feedback',
]

/** Record → 可 JSON 化的对象；publicExport 是 PocketBase 自带的公开导出 */
function serialize(record) {
  if (record && typeof record.publicExport === 'function') {
    const exported = record.publicExport()
    if (exported) return exported
  }
  return JSON.parse(JSON.stringify(record))
}

module.exports = { EXPORT_COLLECTIONS: EXPORT_COLLECTIONS, serialize: serialize }

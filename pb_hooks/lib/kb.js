// 照护知识问答检索模块
// 中文无分词：用关键词表命中 + 2-gram 切片做粗检索，足够原型期使用且零外部依赖。
// 若后续接入 LLM，只需把 answer() 的返回从「拼接原文」换成「检索结果 + 模型润色」。

function grams(text) {
  const cleaned = String(text || '').replace(/[\s，。？！、,.?!；;：:（）()【】\[\]"'“”‘’-]/g, '')
  const out = []
  for (let i = 0; i + 2 <= cleaned.length; i++) {
    out.push(cleaned.substr(i, 2))
  }
  return out
}

function scoreEntry(record, question, gramList) {
  const keywords = String(record.get('keywords') || '')
    .split(/\s+/)
    .filter(function (k) {
      return k.length > 0
    })
  const title = String(record.get('title') || '')
  const content = String(record.get('content') || '')

  let score = 0
  for (let i = 0; i < keywords.length; i++) {
    if (question.indexOf(keywords[i]) >= 0) score += 6
  }
  for (let i = 0; i < gramList.length; i++) {
    if (title.indexOf(gramList[i]) >= 0) score += 2
    if (content.indexOf(gramList[i]) >= 0) score += 0.5
  }
  return score
}

const NO_MATCH_ANSWER =
  '我没有在知识库中找到与这个问题直接相关的条目。建议换一种说法描述，或直接联系专业人员咨询。\n' +
  '如果照护者本人出现持续两周以上的情绪低落、失眠或无法正常进食，请及时寻求专业心理或医疗支持。'

function answer(question) {
  const entries = $app.findRecordsByFilter('kb_entries', '', '', 200, 0)
  const gramList = grams(question)

  const scored = []
  for (let i = 0; i < entries.length; i++) {
    const score = scoreEntry(entries[i], question, gramList)
    if (score > 0) scored.push({ score: score, record: entries[i] })
  }
  scored.sort(function (a, b) {
    return b.score - a.score
  })

  const top = scored.slice(0, 3)
  if (top.length === 0) {
    return { answer: NO_MATCH_ANSWER, sources: [] }
  }

  const sources = []
  let text = '根据照护知识库，为您找到以下内容：\n'
  for (let i = 0; i < top.length; i++) {
    const record = top[i].record
    sources.push({
      id: record.id,
      title: String(record.get('title')),
      category: String(record.get('category') || ''),
    })
    text += '\n【' + String(record.get('title')) + '】\n' + String(record.get('content')) + '\n'
    if (i < top.length - 1) text += '\n————————\n'
  }
  return { answer: text, sources: sources }
}

module.exports = { answer: answer }

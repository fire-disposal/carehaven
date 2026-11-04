/// <reference path="../pb_data/types.d.ts" />
// 智能体会话记录与计费字段
//
// 原型阶段的取舍：
//   - 会话按 conversation_id 串起来，消息仍存在 qa_sessions（一问一答一条）；
//   - 记录模型、提示版本、token 用量与估算费用，供配额与运营台使用；
//   - source 区分检索问答（kb）与助手（agent），前者保持原样。

migrate(
  (app) => {
    const qa = app.findCollectionByNameOrId('qa_sessions')

    qa.fields.add(new Field({ name: 'conversation_id', type: 'text', max: 40 }))
    qa.fields.add(
      new Field({ name: 'source', type: 'select', values: ['kb', 'agent'], maxSelect: 1 })
    )
    qa.fields.add(new Field({ name: 'model', type: 'text', max: 60 }))
    qa.fields.add(new Field({ name: 'prompt_version', type: 'text', max: 20 }))
    qa.fields.add(new Field({ name: 'tokens_in', type: 'number', min: 0 }))
    qa.fields.add(new Field({ name: 'tokens_out', type: 'number', min: 0 }))
    // 估算费用（人民币元），按配置单价折算；不是账单，只用于配额与观测
    qa.fields.add(new Field({ name: 'cost_yuan', type: 'number', min: 0 }))
    qa.fields.add(new Field({ name: 'tools', type: 'json', maxSize: 4000 }))
    qa.fields.add(new Field({ name: 'safety_flag', type: 'bool' }))

    qa.indexes = qa.indexes.concat([
      'CREATE INDEX idx_qa_conversation ON qa_sessions (conversation_id)',
      'CREATE INDEX idx_qa_source_created ON qa_sessions (source, created DESC)',
    ])
    app.save(qa)
  },
  (app) => {
    const qa = app.findCollectionByNameOrId('qa_sessions')
    for (const name of [
      'conversation_id',
      'source',
      'model',
      'prompt_version',
      'tokens_in',
      'tokens_out',
      'cost_yuan',
      'tools',
      'safety_flag',
    ]) {
      try {
        qa.fields.removeByName(name)
      } catch (e) {
        // 忽略
      }
    }
    app.save(qa)
  }
)

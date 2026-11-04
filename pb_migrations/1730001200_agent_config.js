/// <reference path="../pb_data/types.d.ts" />
// 助手默认配置：配额与计价
//
// 计价为「估算」，用于配额与观测，不是账单；实际单价以服务商后台为准。
// 密钥不落库：只从环境变量 DEEPSEEK_API_KEY 读取。

migrate(
  (app) => {
    const configC = app.findCollectionByNameOrId('app_config')

    const defaults = [
      {
        key: 'agent_limits',
        value: {
          enabled: true,
          requests_per_day: 20,
          tokens_per_day: 60000,
          budget_yuan_per_day: 1.0,
          global_tokens_per_day: 400000,
        },
        description:
          '助手配额：每用户每日请求数/token/费用，以及全站每日 token 上限（防止单用户耗尽资源）',
      },
      {
        key: 'agent_pricing',
        value: { input_per_million: 2, output_per_million: 8 },
        description: '助手计价（元 / 百万 token），用于估算费用与日预算；不是账单口径',
      },
    ]

    for (const item of defaults) {
      try {
        app.findFirstRecordByFilter('app_config', 'key = {:key}', { key: item.key })
      } catch (e) {
        app.save(new Record(configC, item))
      }
    }
  },
  (app) => {
    for (const key of ['agent_limits', 'agent_pricing']) {
      try {
        app.delete(app.findFirstRecordByFilter('app_config', 'key = {:key}', { key: key }))
      } catch (e) {
        // 忽略
      }
    }
  }
)

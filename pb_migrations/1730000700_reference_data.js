/// <reference path="../pb_data/types.d.ts" />
// 参考数据：干预方案库与默认 HPS 配置
//
// 背景：演示数据（demo 账号 / simulated 生理 / 示例帖子）已由 SEED_DEMO 开关控制，
// 但方案库与默认参数属于**运行必需**，任何环境都要有。本迁移幂等写入：
// 只在该表为空时插入，不覆盖管理员后来改过的值。

migrate(
  (app) => {
    // ---------- 默认参数（仅在缺失时写入） ----------
    const configC = app.findCollectionByNameOrId('app_config')
    const defaults = [
      {
        key: 'hps_weights',
        value: { w1: 0.4, w2: 0.4, w3: 0.2 },
        description: 'HPS 权重：生理 / 心理 / 上下文，Σwi = 1；由专家赋权后经后台修改',
      },
      {
        key: 'level_thresholds',
        value: { t_green: 40, t_red: 70 },
        description: '三色分层阈值：HPS < t_green 绿色；t_green ≤ HPS < t_red 黄色；≥ t_red 红色',
      },
      {
        key: 'daily_quota',
        value: { ask: 60, tts: 20 },
        description: '每用户每日调用上限：问答次数 / 语音合成次数（命中缓存不计数）',
      },
      {
        key: 'physio_normal_range',
        value: { hrv: [20, 60], gsr: [2, 8], sleep_quality: [40, 90] },
        description: '生理指标归一化区间 [lo, hi]',
      },
    ]

    for (const item of defaults) {
      try {
        app.findFirstRecordByFilter('app_config', 'key = {:key}', { key: item.key })
      } catch (e) {
        app.save(new Record(configC, item))
      }
    }

    // ---------- 干预方案（仅在方案库为空时写入） ----------
    const interventionsC = app.findCollectionByNameOrId('interventions')
    let existing = []
    try {
      existing = app.findRecordsByFilter('interventions', '', '', 1, 0)
    } catch (e) {
      existing = []
    }
    if (existing.length > 0) return

    const interventions = [
      {
        title: '4-7-8 呼吸法',
        category: '呼吸放松',
        level_target: 'yellow',
        duration_min: 5,
        cover_emoji: '🌬️',
        sort: 1,
        description: '吸气 4 秒、屏息 7 秒、呼气 8 秒，重复 4 轮。适合情绪紧绷时快速平复。',
      },
      {
        title: '腹式呼吸练习',
        category: '呼吸放松',
        level_target: 'green',
        duration_min: 5,
        cover_emoji: '🫁',
        sort: 2,
        description: '手放腹部，缓慢深长呼吸，帮助维持日常放松基线。',
      },
      {
        title: '红区紧急放松包',
        category: '呼吸放松',
        level_target: 'red',
        duration_min: 6,
        cover_emoji: '🚨',
        sort: 3,
        description: '压力显著超标时使用：渐进式肌肉放松 + 引导呼吸，先降唤起再处理问题。',
      },
      {
        title: '身体扫描冥想',
        category: '冥想练习',
        level_target: 'yellow',
        duration_min: 10,
        cover_emoji: '🧘',
        sort: 4,
        description: '从头到脚逐段觉察身体感受，缓解长期照护带来的躯体紧张。',
      },
      {
        title: '正念呼吸引导',
        category: '冥想练习',
        level_target: 'green',
        duration_min: 8,
        cover_emoji: '🌿',
        sort: 5,
        description: '把注意力锚定在呼吸上，练习与压力共处而不被卷走。',
      },
      {
        title: '舒缓音乐疗愈',
        category: '音乐疗法',
        level_target: 'yellow',
        duration_min: 15,
        cover_emoji: '🎵',
        sort: 6,
        description: '经研究支持的音乐治疗片段，可佩戴耳机在患者休息时进行。',
      },
      {
        title: '自然白噪音',
        category: '音乐疗法',
        level_target: 'green',
        duration_min: 20,
        cover_emoji: '🌧️',
        sort: 7,
        description: '海浪、雨声等，兼顾助眠与放松，适合睡前使用。',
      },
      {
        title: '照护者减压操',
        category: '视频指导',
        level_target: 'yellow',
        duration_min: 12,
        cover_emoji: '🤸',
        sort: 8,
        description: '坐姿可完成的颈肩腰背舒展动作，缓解长时间照护的身体负荷。',
      },
    ]

    for (const item of interventions) {
      app.save(new Record(interventionsC, item))
    }
  },
  (app) => {
    // 回滚：只清掉本迁移保证的默认配置；方案库内容按保留策略单独处理
    for (const key of ['hps_weights', 'level_thresholds', 'physio_normal_range']) {
      try {
        const rec = app.findFirstRecordByFilter('app_config', 'key = {:key}', { key: key })
        app.delete(rec)
      } catch (e) {
        // 不存在即跳过
      }
    }
  }
)

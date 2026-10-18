/// <reference path="../pb_data/types.d.ts" />
// 智护忆站 —— 从 zhiyi-tongxing 迁移失智症照护知识图谱语料
//
// 来源：zhiyi-tongxing@ea1027b（已归档）seed.ts 的 NODES + EXTRA_NODES（36 个节点）。
// 只迁内容，不迁 zhiyi 的前后端代码；每条 desc 作为 content，
// 节点 label 作为 title，ALIASES 别名与描述中的关键名词并入 keywords，
// 供 pb_hooks/lib/kb.js 的关键词命中 + 2-gram 检索使用。
//
// 幂等：按 title 判断，已存在则跳过。时间戳取 1730000300 —— 1730000200 已被
// 1730000200_wechat_auth.js 占用，故排在其后。
//
// 迁移只做数据写入：不建表、不引依赖、不发网络请求。

migrate(
  (app) => {
    const SOURCE = "zhiyi-tongxing@ea1027b（已归档）";
    const kbC = app.findCollectionByNameOrId("kb_entries");

    const entries = [
      {
        title: "失智症",
        category: "日常照护",
        keywords: "失智症 痴呆 失智 老年痴呆 认知障碍 认知衰退 神经退行性",
        content: "一种慢性、进展性的神经退行性疾病，以认知功能逐渐衰退为主要特征，严重影响日常生活能力。",
      },
      {
        title: "阿尔茨海默病",
        category: "日常照护",
        keywords: "阿尔茨海默病 阿尔茨海默 老年痴呆 记忆减退 失智症类型",
        content: "最常见的失智症类型，占 60%–70%，起病隐匿，以记忆减退为早期核心症状。",
      },
      {
        title: "血管性痴呆",
        category: "日常照护",
        keywords: "血管性痴呆 脑血管 卒中 中风 高血压 认知障碍",
        content: "由脑血管病变导致的认知障碍，与高血压、卒中密切相关，需控制血管危险因素。",
      },
      {
        title: "记忆减退",
        category: "行为应对",
        keywords: "记忆减退 记忆 忘记 健忘 找不到物品 重复提问",
        content: "早期表现为近期记忆下降，如忘记刚说的话、找不到物品、重复提问。",
      },
      {
        title: "行为异常",
        category: "行为应对",
        keywords: "行为异常 BPSD 精神行为症状 游走 攻击 幻觉 重复提问 环境",
        content: "失智症常见的精神行为症状（BPSD），包括游走、攻击、幻觉、重复提问等，多与照护方式不当或环境不适有关。",
      },
      {
        title: "游走",
        category: "行为应对",
        keywords: "游走 走来走去 乱走 走失 找不到家 走动 离家 迷路",
        content: "患者无目的地走动或试图离家，存在走失与跌倒风险。",
      },
      {
        title: "攻击行为",
        category: "行为应对",
        keywords: "攻击行为 打人 骂人 发脾气 暴躁 攻击 言语攻击 肢体",
        content: "患者出现言语或肢体攻击，多由恐惧、疼痛、误解或需求未被满足引发。",
      },
      {
        title: "幻觉妄想",
        category: "行为应对",
        keywords: "幻觉妄想 说胡话 幻觉 看到不存在 疑心 妄想 被偷 被害",
        content: "患者看到/听到不存在的事物，或坚信被偷窃、被伤害等无根据的想法。",
      },
      {
        title: "重复提问",
        category: "行为应对",
        keywords: "重复提问 反复问 唠叨 反复问同一个问题 记忆受损",
        content: "患者反复问同一个问题，源于记忆受损，并非故意捣乱。",
      },
      {
        title: "睡眠紊乱",
        category: "行为应对",
        keywords: "睡眠紊乱 不睡觉 睡不着 失眠 晚上闹 夜醒 日落综合征 白天嗜睡",
        content: "白天嗜睡、夜间不安或「日落综合征」，打乱照护者作息。",
      },
      {
        title: "沟通困难",
        category: "沟通技巧",
        keywords: "沟通困难 不说话 表达 理解 语言 沟通",
        content: "患者理解与表达语言能力下降，需要照护者调整沟通方式。",
      },
      {
        title: "游走应对策略",
        category: "行为应对",
        keywords: "游走 走来走去 乱走 走失 找不到家 门磁 定位 报警 高位置锁 散步 走失预防",
        content: "保持家居环境熟悉整洁；白天增加散步等体力活动消耗精力；安装门磁/床垫报警与高位置锁；为患者佩戴定位手环或卡片；提前告知邻居，走失时第一时间报警并调取周边监控。",
      },
      {
        title: "攻击行为应对策略",
        category: "行为应对",
        keywords: "攻击行为 打人 骂人 发脾气 暴躁 转移注意力 安全距离 疼痛 争辩",
        content: "先退后一步、保持安全距离，不要争辩或强行制止；尝试转移注意力到其喜欢的话题或物品；排查疼痛、饥饿、如厕等生理需求；观察触发情境并记录，减少诱发因素；必要时寻求医护人员评估用药。",
      },
      {
        title: "幻觉妄想应对策略",
        category: "行为应对",
        keywords: "幻觉妄想 幻觉 妄想 说胡话 疑心 不争辩 环境 光线",
        content: "不争辩、不否定患者感受，可温和回应「我理解你看到/担心的事」；转移话题或环境；检查光线、噪音等环境诱因；如幻觉引发恐惧或危险，及时就医。",
      },
      {
        title: "重复提问应对策略",
        category: "行为应对",
        keywords: "重复提问 反复问 唠叨 耐心 视觉提示 日历 卡片",
        content: "保持耐心，每次都像第一次回答一样温和回应；把答案写下来贴在显眼处；用照片、日历等视觉提示辅助记忆；观察是否因焦虑或需求未被满足而提问。",
      },
      {
        title: "睡眠紊乱应对策略",
        category: "行为应对",
        keywords: "睡眠紊乱 不睡觉 睡不着 失眠 晚上闹 作息 午睡 咖啡因 夜醒",
        content: "固定作息时间，白天多安排活动减少午睡时长；睡前避免咖啡因与激烈活动，保持卧室昏暗安静；夜间醒来轻声安抚，检查是否疼痛或需如厕；如持续严重，咨询医生。",
      },
      {
        title: "沟通技巧",
        category: "沟通技巧",
        keywords: "沟通技巧 沟通 说话 交流 眼神 简短 二选一 倾听 语调",
        content: "面对面交流、保持眼神接触；用简短句子一次只问一件事；给出二选一而非开放式问题；耐心倾听、不打断、不争辩；配合手势与温和语调；肯定患者的感受与努力。",
      },
      {
        title: "用药管理",
        category: "日常照护",
        keywords: "用药管理 吃药 用药 药 药盒 服药 停药 复诊",
        content: "使用药盒分装、设置闹钟提醒；记录服药反应；不自行停药或加量；定期带患者复诊，向医生反馈行为变化以调整用药。",
      },
      {
        title: "饮食营养管理",
        category: "日常照护",
        keywords: "饮食营养管理 吃饭 饮食 不肯吃 营养 饮水 吞咽 呛咳 高蛋白",
        content: "定时定量、细软易嚼；多给高蛋白与蔬果，限制高糖高盐；保证充足饮水；进食呛咳时及时就医排查吞咽障碍；营造安静就餐环境。",
      },
      {
        title: "居家安全改造",
        category: "日常照护",
        keywords: "居家安全改造 安全 跌倒 摔 扶手 防滑 门窗 药品 刀具 燃气 烫伤",
        content: "清除地面杂物与门槛，浴室加装扶手防滑垫；夜间留小夜灯；锁好门窗与危险物品（药品、刀具、燃气）；电热水器调低温度防烫伤。",
      },
      {
        title: "活动安排",
        category: "日常照护",
        keywords: "活动安排 活动 锻炼 散步 兴趣 叠毛巾 浇花 听歌 规律",
        content: "根据患者兴趣安排简单可完成的日常活动（叠毛巾、浇花、听老歌）；将任务拆解为小步骤并示范；规律活动可减少行为问题、提升情绪。",
      },
      {
        title: "洗澡穿衣照护",
        category: "日常照护",
        keywords: "洗澡穿衣照护 洗澡 穿衣 洗浴 换衣 隐私 衣物 洗漱",
        content: "固定洗浴时间与流程，提前备好衣物；尊重隐私，避免催促；选择宽松易穿脱的衣物；把「洗澡」拆成小指令一步步引导。",
      },
      {
        title: "照护技能培训",
        category: "日常照护",
        keywords: "照护技能培训 照顾 怎么照顾 照护技能 培训 课程 学习 无力感",
        content: "通过 WHO iSupport 本土化课程、社区护理培训与在线照护知识库系统学习失智症照护技能，减少照护中的无力感。",
      },
      {
        title: "照护者压力",
        category: "自我关怀",
        keywords: "照护者压力 压力 累 崩溃 焦虑 抑郁 高压 情绪消耗 支持不足",
        content: "超过 65% 的家庭照护者长期处于高压状态，存在焦虑、抑郁风险。压力来源于技能匮乏、情绪消耗与社会支持不足，需要主动监测与干预。",
      },
      {
        title: "照护者情绪",
        category: "自我关怀",
        keywords: "照护者情绪 情绪 内疚 无助 焦虑 抑郁 ABC",
        content: "照护者的情绪（焦虑、内疚、无助）是 ABC 情绪理论中的结果 C，通过调整认知信念（B）可以有效改善。",
      },
      {
        title: "呼吸放松",
        category: "自我关怀",
        keywords: "呼吸放松 放松 4-7-8 呼吸 副交感 心率 紧张",
        content: "4-7-8 呼吸法：吸气 4 秒、屏息 7 秒、呼气 8 秒，重复 4 轮，可快速激活副交感神经、降低心率。",
      },
      {
        title: "4-7-8呼吸法",
        category: "自我关怀",
        keywords: "4-7-8呼吸法 呼吸 放松 吸气 屏息 呼气 情绪失控",
        content: "用鼻子吸气 4 秒 → 屏息 7 秒 → 用嘴缓缓呼气 8 秒，循环 4 次，适合情绪即将失控时使用。",
      },
      {
        title: "正念冥想",
        category: "自我关怀",
        keywords: "正念冥想 冥想 正念 身体扫描 觉察 压力",
        content: "每天 10 分钟身体扫描或正念呼吸，不加评判地觉察当下，可有效缓解慢性照护压力。",
      },
      {
        title: "社会支持",
        category: "自我关怀",
        keywords: "社会支持 求助 支持 找人帮忙 倾诉 互助 社群 孤独",
        content: "加入照护者互助社群、参加社区支持小组，或向亲友倾诉，社会支持是照护者心理健康最重要的保护因素。",
      },
      {
        title: "喘息服务",
        category: "自我关怀",
        keywords: "喘息服务 喘息 托护 日间照料 轮班 休息 脱离照护",
        content: "利用社区日间照料中心、短期托护或亲属轮班，让自己定期脱离照护场景，恢复精力。",
      },
      {
        title: "社区互助小组",
        category: "自我关怀",
        keywords: "社区互助小组 互助小组 社群 经验分享 情感支持 孤独",
        content: "参与社区或线上「照护者互助小组」，经验分享与情感支持可显著降低孤独感。",
      },
      {
        title: "心理咨询热线",
        category: "自我关怀",
        keywords: "心理咨询热线 热线 12356 96525 120 心理援助 紧急",
        content: "全国心理援助热线 12356；浙江省心理援助热线 96525；紧急情况拨打 120。",
      },
      {
        title: "照护者",
        category: "自我关怀",
        keywords: "照护者 家属 配偶 子女 亲属",
        content: "家庭照护者：配偶、子女及其他近亲属，是失智症照护体系的核心主体。",
      },
      {
        title: "ABC情绪理论",
        category: "自我关怀",
        keywords: "ABC情绪理论 ABC 情绪理论 信念 认知 事件",
        content: "情绪（C）并非由事件（A）直接引起，而是由对事件的信念（B）决定。调整认知信念可改善情绪结果。",
      },
      {
        title: "争辩指责",
        category: "沟通技巧",
        keywords: "争辩指责 争辩 指责 争吵 误区 焦虑",
        content: "与失智症患者争辩或指责会加剧其焦虑与行为问题，应避免。",
      },
      {
        title: "走失跌倒",
        category: "日常照护",
        keywords: "走失跌倒 走失 跌倒 走丢 风险 防范",
        content: "游走可能导致的严重风险，需提前防范。",
      },
    ];

    let imported = 0;
    let skipped = 0;
    for (const entry of entries) {
      let exists = null;
      try {
        exists = app.findFirstRecordByFilter("kb_entries", "title = {:title}", {
          title: entry.title,
        });
      } catch (e) {
        exists = null; // 未命中时 findFirstRecordByFilter 抛错，视为不存在
      }
      if (exists) {
        skipped += 1;
        continue;
      }
      app.save(new Record(kbC, Object.assign({ source: SOURCE }, entry)));
      imported += 1;
    }
    console.log(
      "zhiyi 知识条目迁移完成：导入 " + imported + " 条，跳过已存在 " + skipped + " 条"
    );
  },
  (app) => {
    // 回滚：只删除本次迁移写入的记录（按 source 前缀识别），不碰原有 iSupport 条目
    let records = [];
    try {
      records = app.findRecordsByFilter(
        "kb_entries",
        "source ~ {:prefix}",
        "",
        500,
        0,
        { prefix: "zhiyi-tongxing@" }
      );
    } catch (e) {
      records = [];
    }
    for (const record of records) {
      app.delete(record);
    }
    console.log("zhiyi 知识条目回滚完成：删除 " + records.length + " 条");
  }
);

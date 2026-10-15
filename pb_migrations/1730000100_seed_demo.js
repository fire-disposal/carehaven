/// <reference path="../pb_data/types.d.ts" />
// 智护忆站 —— 演示数据种子
// 重要：physio_records.source 全部标记为 "simulated"。
// 这些是生理学合理区间内的合成数据，不是真实设备采集，用于演示系统链路，
// 论文与汇报中必须同样标注，不得描述为真实采集数据。

migrate(
  (app) => {
    // 确定性伪随机，保证每次重建数据一致
    let seed = 20260615;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const fmt = (d) => {
      return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, ".000Z");
    };

    const users = app.findCollectionByNameOrId("users");
    const checkinsC = app.findCollectionByNameOrId("checkins");
    const physioC = app.findCollectionByNameOrId("physio_records");
    const scoresC = app.findCollectionByNameOrId("stress_scores");
    const interventionsC = app.findCollectionByNameOrId("interventions");
    const logsC = app.findCollectionByNameOrId("intervention_logs");
    const kbC = app.findCollectionByNameOrId("kb_entries");
    const postsC = app.findCollectionByNameOrId("posts");
    const commentsC = app.findCollectionByNameOrId("comments");
    const ratingsC = app.findCollectionByNameOrId("ratings");
    const configC = app.findCollectionByNameOrId("app_config");

    // ---------- 演示用户 ----------
    const user = new Record(users, {
      email: "demo@zz.local",
      password: "demo123456",
      passwordConfirm: "demo123456",
      name: "李阿姨",
    });
    app.save(user);

    // 第二位用户，用于社群数据的真实感
    const user2 = new Record(users, {
      email: "demo2@zz.local",
      password: "demo123456",
      passwordConfirm: "demo123456",
      name: "小满",
    });
    app.save(user2);

    // ---------- 系统配置：HPS 权重与三色阈值 ----------
    const cfg = [
      {
        key: "hps_weights",
        value: { w1: 0.4, w2: 0.4, w3: 0.2 },
        description: "HPS 权重：生理 / 心理 / 上下文，Σwi = 1，可由专家意见动态调整",
      },
      {
        key: "level_thresholds",
        value: { t_green: 40, t_red: 70 },
        description: "三色分层阈值：HPS < 40 绿色；40 ≤ HPS < 70 黄色；HPS ≥ 70 红色",
      },
      {
        key: "physio_normal_range",
        value: { hrv: [20, 60], gsr: [2, 8], sleep_quality: [40, 90] },
        description: "生理指标正常参考区间，用于归一化",
      },
    ];
    for (const c of cfg) {
      app.save(new Record(configC, c));
    }

    // ---------- 减压方案库 ----------
    const interventions = [
      { title: "4-7-8 呼吸法", category: "呼吸放松", level_target: "yellow", duration_min: 5, cover_emoji: "🌬️", sort: 1, description: "吸气 4 秒、屏息 7 秒、呼气 8 秒，重复 4 轮。适合情绪紧绷时快速平复。" },
      { title: "腹式呼吸练习", category: "呼吸放松", level_target: "green", duration_min: 5, cover_emoji: "🫁", sort: 2, description: "手放腹部，缓慢深长呼吸，帮助维持日常放松基线。" },
      { title: "红区紧急放松包", category: "呼吸放松", level_target: "red", duration_min: 6, cover_emoji: "🚨", sort: 3, description: "压力显著超标时使用：渐进式肌肉放松 + 引导呼吸，先降唤起再处理问题。" },
      { title: "身体扫描冥想", category: "冥想练习", level_target: "yellow", duration_min: 10, cover_emoji: "🧘", sort: 4, description: "从头到脚逐段觉察身体感受，缓解长期照护带来的躯体紧张。" },
      { title: "正念呼吸引导", category: "冥想练习", level_target: "green", duration_min: 8, cover_emoji: "🌿", sort: 5, description: "把注意力锚定在呼吸上，练习与压力共处而不被卷走。" },
      { title: "舒缓音乐疗愈", category: "音乐疗法", level_target: "yellow", duration_min: 15, cover_emoji: "🎵", sort: 6, description: "经研究支持的音乐治疗片段，可佩戴耳机在患者休息时进行。" },
      { title: "自然白噪音", category: "音乐疗法", level_target: "green", duration_min: 20, cover_emoji: "🌧️", sort: 7, description: "海浪、雨声等，兼顾助眠与放松，适合睡前使用。" },
      { title: "照护者减压操", category: "视频指导", level_target: "yellow", duration_min: 12, cover_emoji: "🤸", sort: 8, description: "坐姿可完成的颈肩腰背舒展动作，缓解长时间照护的身体负荷。" },
    ];
    const savedInterventions = [];
    for (const it of interventions) {
      const r = new Record(interventionsC, it);
      app.save(r);
      savedInterventions.push(r);
    }

    // ---------- 照护知识库（WHO iSupport 本土化内容）----------
    const kb = [
      {
        title: "患者反复问同一个问题怎么办",
        category: "行为应对",
        keywords: "重复 提问 追问 同样 问题 记忆",
        content:
          "重复提问通常源于短期记忆受损与不安全感，而不是故意为难。应对要点：①不要纠正或强调「你刚问过」，那会加重挫败感；②用同样的耐心简短回答，或把答案写在纸上贴在显眼处；③转移注意力到具体动作，如一起喝口水、看窗外；④观察是否由饥饿、疼痛、想上厕所等身体不适引发。",
        source: "WHO iSupport 本土化改编",
      },
      {
        title: "患者夜间不睡、反复起床怎么办",
        category: "日常照护",
        keywords: "夜间 失眠 起夜 游走 睡 昼夜 颠倒",
        content:
          "①白天尽量安排光照与适度活动，减少白天卧床；②固定睡前流程：温水泡脚、调暗灯光、播放熟悉的轻音乐；③傍晚后避免咖啡、浓茶与大量饮水；④夜间起床时用柔和夜灯并检查地面障碍，降低跌倒风险；⑤若持续两周以上，记录睡眠日志并就诊排查疼痛、尿路感染等躯体因素。",
        source: "WHO iSupport 本土化改编",
      },
      {
        title: "患者出现攻击言行时如何应对",
        category: "行为应对",
        keywords: "打人 骂人 攻击 暴躁 发脾气 激越",
        content:
          "攻击行为多由恐惧、疼痛或沟通受挫引发。安全要点：①先保证自己与患者的安全，保持一臂以上距离，不要正面争执或强行制止；②降低音量、放慢语速，用短句表达「我在，别怕」；③观察与记录触发情境（时间、地点、前序事件），从中找出规律；④事后不要记仇或立刻讲道理，等情绪平复再处理事情；⑤频繁发生需寻求专业评估。",
        source: "WHO iSupport 本土化改编",
      },
      {
        title: "患者拒绝洗澡、换衣服",
        category: "日常照护",
        keywords: "洗澡 洗漱 换衣 拒绝 清洁 护理",
        content:
          "拒绝清洁常与水温不适、怕滑倒、隐私感或对流程不理解有关。做法：①把步骤拆小，先只做洗手或擦脸，逐步推进；②保持浴室温暖、准备防滑垫，提前把衣物按顺序摆好；③用「我们先洗个手，水是温的」这类具体提示代替命令；④尊重患者的羞耻感，减少围观人数、用浴巾遮挡；⑤固定时间与固定流程能显著降低抗拒。",
        source: "WHO iSupport 本土化改编",
      },
      {
        title: "患者怀疑家人、说东西被偷",
        category: "情绪调适",
        keywords: "被害 妄想 怀疑 偷 藏东西 不信任",
        content:
          "这类想法源于记忆缺失后的自我解释，争论事实往往无效。建议：①不辩驳真假，先认可感受——「找不到东西确实让人着急」；②陪着一起找，往往能在常用位置找到；③准备一个固定收纳盒，把常丢物品拍照标注；④避免当众质疑或嘲笑；⑤若伴随强烈恐惧或影响进食睡眠，请及时就医。",
        source: "WHO iSupport 本土化改编",
      },
      {
        title: "照护者情绪崩溃时如何自助",
        category: "自我关怀",
        keywords: "崩溃 情绪 哭 撑不住 焦虑 抑郁 自己",
        content:
          "照顾者的情绪耗竭需要被当作真实问题对待：①先做 3 分钟缓慢呼吸，让身体从警报状态退出；②把「我现在做不到全部」写下来，明确今天只完成一到两件事；③找一个可说话的人，哪怕只说十分钟；④持续两周以上的低落、失眠或失去兴趣，应主动寻求心理或医疗支持；⑤接受帮助不是失职，是维持长期照护能力的必要条件。",
        source: "WHO iSupport 本土化改编",
      },
      {
        title: "如何与患者有效沟通",
        category: "沟通技巧",
        keywords: "沟通 说话 交流 听不懂 表达 对话",
        content:
          "①面对面、保持眼神接触，先叫名字再说话；②一次只说一件事，用短句、放慢语速；③给足反应时间，不要替他接话；④用是/否式问题替代开放式提问；⑤多用手势、实物或照片辅助；⑥对方说不清时，先猜其感受再确认：「你是担心明天的事，对吗？」",
        source: "WHO iSupport 本土化改编",
      },
      {
        title: "照护者的睡眠保护",
        category: "自我关怀",
        keywords: "睡眠 累 熬夜 休息 疲惫 精力",
        content:
          "长期碎片化睡眠是照护者健康最大的隐性损耗。可行做法：①与家人或护工排班，保证每周至少两晚连续睡满 6 小时；②患者白天小睡时，自己不要用来做家务，优先补觉；③睡前 1 小时离开照护环境，做些与照护无关的事；④咖啡因尽量在中午前摄入；⑤把睡眠当作照护工作的一部分来安排，而不是等有空再说。",
        source: "WHO iSupport 本土化改编",
      },
      {
        title: "什么时候需要寻求专业帮助",
        category: "自我关怀",
        keywords: "就医 专业 咨询 看医生 转介 求助",
        content:
          "出现以下情况建议尽快联系专业人员：①患者出现明显疼痛、发热、突然加重的意识混乱；②出现自伤或伤人风险；③照护者连续两周以上情绪低落、失眠、无法正常进食；④出现无法应对的照护技术问题（如吞咽困难、压疮）；⑤照护者产生「我撑不下去了」的念头——此时请立即寻求帮助，而不是独自硬扛。",
        source: "项目组专家意见整理",
      },
      {
        title: "走失预防与走失后的应对",
        category: "日常照护",
        keywords: "走失 迷路 出门 找不到 外出 安全",
        content:
          "预防：①门上装提示铃或高位插销；②衣服内缝姓名与联系电话卡；③避开人流高峰与陌生环境；④手机开启位置共享；⑤记录常去地点与路线。走失后：①立即在常去地点与周边搜寻并报警，不要等 24 小时；②提供近期照片、衣着与疾病说明；③联系社区与公交、地铁失物渠道；④找到后不责备，先安抚再排查诱发因素。",
        source: "WHO iSupport 本土化改编",
      },
      {
        title: "进食困难与吞咽问题",
        category: "日常照护",
        keywords: "吃饭 进食 吞咽 呛 食欲 营养不良",
        content:
          "①固定就餐时间与环境，减少电视等干扰；②食物切小块或打成糊状，避免干硬、粘性大的食物；③坐直进食，小口慢咽，口中有食物时不说话；④出现频繁呛咳、声音变湿或进食后发热，需尽快就医评估吞咽功能；⑤记录一周进食量，作为就诊依据。",
        source: "项目组专家意见整理",
      },
      {
        title: "家人之间如何分配照护责任",
        category: "沟通技巧",
        keywords: "分工 家人 亲属 兄弟姐妹 责任 商量",
        content:
          "①把照护任务列成清单（就医、陪护、财务、夜间值守），按人力和时间明确到人；②允许贡献形式不同：出钱、出力、陪伴都算参与；③定期开会复盘，把情绪与事实分开谈；④主要照护者应主动提出具体请求（「周四下午你能来两小时吗」），比笼统抱怨更有效；⑤必要时引入外部照护服务，避免家庭内部消耗。",
        source: "项目组专家意见整理",
      },
      {
        title: "面对疾病进展的哀伤与无力感",
        category: "情绪调适",
        keywords: "哀伤 悲伤 无力 接受 难过 失去",
        content:
          "在患者仍在世时就开始的告别感（预期性哀伤）是普遍且正常的。①允许自己难过，情绪不是不坚强的证据；②记录患者仍保留的能力与你们之间好的时刻，而非只关注丧失；③与同伴互助小组交流，被理解本身就有缓解作用；④若长期陷于麻木、自责或回避，建议接受专业心理支持。",
        source: "WHO iSupport 本土化改编",
      },
      {
        title: "喘息服务与外部资源",
        category: "自我关怀",
        keywords: "喘息 托养 护工 资源 政策 补贴 帮忙",
        content:
          "①了解当地居家养老服务与老年人照护补贴政策；②短时托养或日间照料中心可提供每周数小时的喘息窗口；③咨询社区卫生服务中心的家庭照护支持项目；④使用过的照护者建议提前整理「照护交接说明」，让临时照护者能快速接手。",
        source: "项目组政策梳理",
      },
    ];
    for (const entry of kb) {
      app.save(new Record(kbC, entry));
    }

    // ---------- 30 天数据（叙事：压力爬升 → 干预介入 → 逐步恢复）----------
    const days = 30;
    const scoreByIndex = [];

    for (let i = days - 1; i >= 0; i--) {
      const dayOffset = i; // 0 = 今天
      const d = new Date(Date.now() - dayOffset * 86400000);
      const progress = (days - 1 - dayOffset) / (days - 1); // 0 → 1

      // 压力轨迹：前段爬升 → 红区平台 → 干预介入后回落
      let base;
      if (progress < 0.55) {
        base = 30 + progress * 104; // 30 → ~87
      } else if (progress < 0.72) {
        base = 86; // 红区平台
      } else {
        base = 86 - (progress - 0.72) * 128; // 回落到 ~50（今日停在黄区：恢复中）
      }
      const hps = clamp(base + (rnd() - 0.5) * 6, 12, 92);

      // 生理得分与 HPS 正相关，心理得分波动稍大
      const scorePhysio = clamp(hps + (rnd() - 0.5) * 8, 5, 98);
      const scorePsycho = clamp(hps + (rnd() - 0.5) * 12, 5, 98);
      const scoreContext = clamp(hps + (rnd() - 0.5) * 15, 5, 98);

      // 生理原始指标：压力越高，HRV 越低、GSR 越高、睡眠质量越差
      const hrv = clamp(62 - scorePhysio * 0.62 + (rnd() - 0.5) * 4, 18, 65);
      const gsr = clamp(2.2 + scorePhysio * 0.055 + (rnd() - 0.5) * 0.8, 1.5, 9);
      const sleepQuality = clamp(92 - scorePsycho * 0.62 + (rnd() - 0.5) * 8, 25, 95);
      const steps = Math.round(clamp(3200 - scorePhysio * 12 + (rnd() - 0.5) * 900, 300, 6000));

      app.save(
        new Record(physioC, {
          user: user.id,
          date: fmt(d),
          hrv: Math.round(hrv * 10) / 10,
          gsr: Math.round(gsr * 100) / 100,
          sleep_quality: Math.round(sleepQuality),
          steps: steps,
          source: "simulated",
        })
      );

      // 主观打卡：早晚各一次
      const periods = [
        { period: "morning", hour: "08:20:00" },
        { period: "evening", hour: "20:40:00" },
      ];
      let psychoSampleSum = 0;
      let psychoSampleCount = 0;
      for (const p of periods) {
        const mood = Math.round(clamp(5.4 - scorePsycho * 0.036 + (rnd() - 0.5) * 0.7, 1, 5));
        const anxiety = Math.round(clamp(scorePsycho * 0.092 + (rnd() - 0.5) * 1.4, 0, 10));
        const fatigue = Math.round(clamp(scorePsycho * 0.088 + (rnd() - 0.5) * 1.6, 0, 10));
        const sleepHours = Math.round(clamp(8.4 - scorePsycho * 0.042 + (rnd() - 0.5) * 1.0, 3, 10) * 10) / 10;
        const careHours = Math.round(clamp(7 + scorePsycho * 0.05 + (rnd() - 0.5) * 3, 2, 16) * 10) / 10;

        app.save(
          new Record(checkinsC, {
            user: user.id,
            date: fmt(new Date(d.toISOString().replace(/T.*/, "T" + p.hour + ".000Z"))),
            period: p.period,
            mood: mood,
            anxiety: anxiety,
            fatigue: fatigue,
            sleep_hours: sleepHours,
            care_hours: careHours,
            note: "",
          })
        );

        const psychoNorm = clamp(
          ((5 - mood) / 4) * 45 + (anxiety / 10) * 35 + (fatigue / 10) * 20,
          0,
          100
        );
        psychoSampleSum += psychoNorm;
        psychoSampleCount++;
      }

      // HPS 结果：与打卡数据一致地算出，而不是随手填
      const weights = { w1: 0.4, w2: 0.4, w3: 0.2 };
      const psychoScore = psychoSampleSum / psychoSampleCount;
      const finalHps = clamp(
        weights.w1 * scorePhysio + weights.w2 * psychoScore + weights.w3 * scoreContext,
        0,
        100
      );
      const level = finalHps < 40 ? "green" : finalHps < 70 ? "yellow" : "red";
      const advice =
        level === "green"
          ? "压力处于安全区间，保持规律作息与日常放松练习即可。"
          : level === "yellow"
            ? "压力已进入预警区间，建议今天完成一次呼吸放松或冥想练习，并留意睡眠。"
            : "压力水平显著超标，建议立即进行一次紧急放松，并考虑向家人或专业人员寻求支持。";

      app.save(
        new Record(scoresC, {
          user: user.id,
          date: fmt(d),
          hps: Math.round(finalHps * 10) / 10,
          score_physio: Math.round(scorePhysio * 10) / 10,
          score_psycho: Math.round(psychoScore * 10) / 10,
          score_context: Math.round(scoreContext * 10) / 10,
          level: level,
          advice: advice,
        })
      );
      scoreByIndex.push(level);
    }

    // ---------- 干预完成记录（红区之后开始出现）----------
    const logPlan = [
      { day: 11, idx: 2, feeling: 4, dur: 6 },
      { day: 9, idx: 0, feeling: 4, dur: 5 },
      { day: 7, idx: 3, feeling: 5, dur: 10 },
      { day: 5, idx: 5, feeling: 4, dur: 15 },
      { day: 3, idx: 1, feeling: 5, dur: 5 },
      { day: 2, idx: 4, feeling: 4, dur: 8 },
      { day: 1, idx: 6, feeling: 5, dur: 20 },
    ];
    for (const p of logPlan) {
      const it = savedInterventions[p.idx];
      app.save(
        new Record(logsC, {
          user: user.id,
          intervention: it.id,
          title_snapshot: it.getString("title"),
          completed_at: fmt(new Date(Date.now() - p.day * 86400000)),
          duration_actual: p.dur,
          feeling: p.feeling,
          note: "",
        })
      );
    }

    // ---------- 社群内容 ----------
    const posts = [
      {
        section: "经验分享",
        nickname: "第3年的照护者",
        anonymous: false,
        likes: 34,
        content:
          "分享一个对我帮助很大的做法：把我妈每天反复问的问题答案写在一张纸上，贴在饭桌旁边。以前一天要回答二十遍，现在她自己会去看，我少了很多火气。",
        comments: ["这个方法我也用过，很有效！", "谢谢分享，今晚就去写一张"],
      },
      {
        section: "情绪树洞",
        nickname: "匿名",
        anonymous: true,
        likes: 58,
        content:
          "今天给我爸洗完澡，他忽然不认识我了，问我是不是护工。我在阳台上站了十分钟才敢回屋。不知道该跟谁说，就写在这里。",
        comments: ["抱抱你，这种时刻太难受了", "我们都在，不用一个人扛"],
      },
      {
        section: "照护技巧",
        nickname: "小满",
        anonymous: false,
        likes: 27,
        content:
          "夜间起夜的问题，我的办法是傍晚之后不喝浓茶，睡前固定流程：泡脚—关大灯开小夜灯—放同一首曲子。坚持两周后夜里醒的次数少了一半。",
        comments: [],
      },
      {
        section: "经验分享",
        nickname: "匿名",
        anonymous: true,
        likes: 41,
        content:
          "兄弟姐妹分工一定要写清楚，我们家一开始都是我在扛，后来列了张表：周三、周六弟弟来陪护，我负责就医，姐姐管财务。说出来之后反而没人推了。",
        comments: [],
      },
      {
        section: "照护技巧",
        nickname: "阿岚",
        anonymous: false,
        likes: 19,
        content:
          "喂饭时容易呛的话，把菜切小一点、坐着吃、口里有东西别说话，这三条基本就能解决大半问题。频繁呛咳一定要去医院看吞咽。",
        comments: ["正好需要，谢谢"],
      },
      {
        section: "情绪树洞",
        nickname: "匿名",
        anonymous: true,
        likes: 46,
        content:
          "有时候会想，如果我先垮了，这个家怎么办。看到这里很多人说「先照顾自己不是自私」，我哭了一场，好像松了一点。",
        comments: ["你不是一个人在撑", "先照顾自己真的不是自私"],
      },
      {
        section: "经验分享",
        nickname: "小满",
        anonymous: false,
        likes: 22,
        content:
          "推荐大家了解一下社区的日间照料中心，我妈每周去两个半天，那两个下午是我这几年最像「自己的时间」的两个下午。",
        comments: [],
      },
      {
        section: "照护技巧",
        nickname: "第3年的照护者",
        anonymous: false,
        likes: 31,
        content:
          "防走失经验：门上加个高位插销，衣服内缝联络卡，手机开位置共享。虽然听起来夸张，但真的走丢过一次之后，这些都值得。",
        comments: ["高位插销这个细节很实用"],
      },
    ];

    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const owner = p.nickname === "小满" ? user2 : user;
      const r = new Record(postsC, {
        user: owner.id,
        nickname: p.nickname,
        section: p.section,
        content: p.content,
        anonymous: p.anonymous,
        likes: p.likes,
        comments_count: p.comments.length,
      });
      app.save(r);

      for (let c = 0; c < p.comments.length; c++) {
        app.save(
          new Record(commentsC, {
            post: r.id,
            user: c % 2 === 0 ? user2.id : user.id,
            nickname: c % 2 === 0 ? "小满" : "匿名",
            content: p.comments[c],
            anonymous: c % 2 !== 0,
          })
        );
      }
    }

    // ---------- 星级反馈 ----------
    const ratings = [
      { target: "intervention", target_id: savedInterventions[3].id, stars: 5, comment: "身体扫描真的能让我从紧绷里退出来。" },
      { target: "intervention", target_id: savedInterventions[0].id, stars: 4, comment: "呼吸法很快，忙的时候也能做。" },
      { target: "app", target_id: "", stars: 5, comment: "三色提示很清楚，红的那天我就知道该找人帮忙了。" },
    ];
    for (const r of ratings) {
      app.save(new Record(ratingsC, Object.assign({ user: user.id }, r)));
    }
  },
  (app) => {
    // 回滚：清空数据（表结构由 init_schema 负责）
    for (const name of [
      "intervention_logs",
      "ratings",
      "comments",
      "posts",
      "qa_sessions",
      "stress_scores",
      "physio_records",
      "checkins",
      "interventions",
      "kb_entries",
      "app_config",
    ]) {
      try {
        const c = app.findCollectionByNameOrId(name);
        app.truncateCollection(c);
      } catch (e) {
        // 忽略
      }
    }
    try {
      app.delete(app.findRecordById("users", app.findFirstRecordByFilter("users", 'email = "demo@zz.local"').id));
    } catch (e) {}
    try {
      app.delete(app.findRecordById("users", app.findFirstRecordByFilter("users", 'email = "demo2@zz.local"').id));
    } catch (e) {}
  }
);

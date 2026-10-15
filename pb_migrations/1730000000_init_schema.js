/// <reference path="../pb_data/types.d.ts" />
// 智护忆站 —— 表结构迁移
// 说明：本文件由 PocketBase 的 JSVM 执行，可用 `./pocketbase migrate up` 复现全部表结构。
// 与 emoguard 的差异：不再有 models.py / serializers / views / admin 四层样板，
// 权限直接表达在 listRule/createRule 等规则里。

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    // 关系字段用户归属的公共写法
    const owner = () => ({
      name: "user",
      type: "relation",
      required: true,
      collectionId: users.id,
      maxSelect: 1,
      cascadeDelete: true,
    });

    const own = "user = @request.auth.id";
    const authed = '@request.auth.id != ""';

    // ---------- 1. 主观打卡（EMA 即时评估）----------
    const checkins = new Collection({
      type: "base",
      name: "checkins",
      fields: [
        owner(),
        { name: "date", type: "date", required: true },
        { name: "period", type: "select", values: ["morning", "evening"], maxSelect: 1 },
        { name: "mood", type: "number", min: 1, max: 5 }, // 当下心情 1-5
        { name: "anxiety", type: "number", min: 0, max: 10 },
        { name: "fatigue", type: "number", min: 0, max: 10 },
        { name: "sleep_hours", type: "number", min: 0, max: 24 },
        { name: "care_hours", type: "number", min: 0, max: 24 }, // 上下文：照护时长
        { name: "note", type: "text", max: 500 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: own,
      viewRule: own,
      createRule: own,
      updateRule: own,
      deleteRule: own,
    });
    app.save(checkins);

    // ---------- 2. 生理数据（设备链路：device / 模拟 / 手动）----------
    const physio = new Collection({
      type: "base",
      name: "physio_records",
      fields: [
        owner(),
        { name: "date", type: "date", required: true },
        { name: "hrv", type: "number", min: 0, max: 200 }, // 心率变异性 ms
        { name: "gsr", type: "number", min: 0, max: 50 }, // 皮肤电反应 µS
        { name: "sleep_quality", type: "number", min: 0, max: 100 },
        { name: "steps", type: "number", min: 0 },
        {
          name: "source",
          type: "select",
          values: ["device", "simulated", "manual"],
          maxSelect: 1,
        }, // 数据来源，用于学术诚信标注
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: own,
      viewRule: own,
      createRule: own,
      updateRule: own,
      deleteRule: own,
    });
    app.save(physio);

    // ---------- 3. HPS 结果（仅服务端写入，用户只读）----------
    const scores = new Collection({
      type: "base",
      name: "stress_scores",
      fields: [
        owner(),
        { name: "date", type: "date", required: true },
        { name: "hps", type: "number", min: 0, max: 100 },
        { name: "score_physio", type: "number", min: 0, max: 100 },
        { name: "score_psycho", type: "number", min: 0, max: 100 },
        { name: "score_context", type: "number", min: 0, max: 100 },
        { name: "level", type: "select", values: ["green", "yellow", "red"], maxSelect: 1 },
        { name: "advice", type: "text", max: 500 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: own,
      viewRule: own,
      createRule: null, // 仅 superuser / 服务端 hook 可写
      updateRule: null,
      deleteRule: null,
    });
    app.save(scores);

    // ---------- 4. 减压方案库 ----------
    const interventions = new Collection({
      type: "base",
      name: "interventions",
      fields: [
        { name: "title", type: "text", required: true },
        {
          name: "category",
          type: "select",
          values: ["呼吸放松", "冥想练习", "音乐疗法", "视频指导"],
          maxSelect: 1,
          required: true,
        },
        { name: "level_target", type: "select", values: ["green", "yellow", "red"], maxSelect: 1 },
        { name: "duration_min", type: "number", min: 1, max: 120 },
        { name: "description", type: "text", max: 500 },
        { name: "media_url", type: "text" },
        { name: "cover_emoji", type: "text", max: 8 },
        { name: "sort", type: "number" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: authed,
      viewRule: authed,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    app.save(interventions);

    // ---------- 5. 干预完成记录 ----------
    const logs = new Collection({
      type: "base",
      name: "intervention_logs",
      fields: [
        owner(),
        {
          name: "intervention",
          type: "relation",
          collectionId: interventions.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: "title_snapshot", type: "text" },
        { name: "completed_at", type: "date", required: true },
        { name: "duration_actual", type: "number" },
        { name: "feeling", type: "number", min: 1, max: 5 },
        { name: "note", type: "text", max: 300 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: own,
      viewRule: own,
      createRule: own,
      updateRule: own,
      deleteRule: own,
    });
    app.save(logs);

    // ---------- 6. 照护知识库（WHO iSupport 本土化）----------
    const kb = new Collection({
      type: "base",
      name: "kb_entries",
      fields: [
        { name: "title", type: "text", required: true },
        {
          name: "category",
          type: "select",
          values: ["行为应对", "情绪调适", "日常照护", "沟通技巧", "自我关怀"],
          maxSelect: 1,
        },
        { name: "keywords", type: "text" }, // 空格分隔，供检索匹配
        { name: "content", type: "text", max: 2000 },
        { name: "source", type: "text" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: authed,
      viewRule: authed,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    app.save(kb);

    // ---------- 7. 问答历史 ----------
    const qa = new Collection({
      type: "base",
      name: "qa_sessions",
      fields: [
        owner(),
        { name: "question", type: "text", required: true },
        { name: "answer", type: "text" },
        { name: "matched_entries", type: "json" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: own,
      viewRule: own,
      createRule: null, // 由 hook 写入
      updateRule: null,
      deleteRule: own,
    });
    app.save(qa);

    // ---------- 8. 社群帖子 ----------
    const posts = new Collection({
      type: "base",
      name: "posts",
      fields: [
        { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        { name: "nickname", type: "text" },
        {
          name: "section",
          type: "select",
          values: ["经验分享", "情绪树洞", "照护技巧"],
          maxSelect: 1,
          required: true,
        },
        { name: "content", type: "text", required: true, max: 1000 },
        { name: "anonymous", type: "bool" },
        { name: "likes", type: "number", min: 0 },
        { name: "comments_count", type: "number", min: 0 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: authed,
      viewRule: authed,
      createRule: '@request.auth.id != ""',
      updateRule: "user = @request.auth.id",
      deleteRule: "user = @request.auth.id",
    });
    app.save(posts);

    // ---------- 9. 帖子评论 ----------
    const comments = new Collection({
      type: "base",
      name: "comments",
      fields: [
        { name: "post", type: "relation", collectionId: posts.id, maxSelect: 1, required: true, cascadeDelete: true },
        { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        { name: "nickname", type: "text" },
        { name: "content", type: "text", required: true, max: 500 },
        { name: "anonymous", type: "bool" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: authed,
      viewRule: authed,
      createRule: authed,
      updateRule: "user = @request.auth.id",
      deleteRule: "user = @request.auth.id",
    });
    app.save(comments);

    // ---------- 10. 星级反馈 ----------
    const ratings = new Collection({
      type: "base",
      name: "ratings",
      fields: [
        owner(),
        { name: "target", type: "select", values: ["intervention", "app"], maxSelect: 1, required: true },
        { name: "target_id", type: "text" },
        { name: "stars", type: "number", min: 1, max: 5, required: true },
        { name: "comment", type: "text", max: 500 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: own,
      viewRule: own,
      createRule: own,
      updateRule: own,
      deleteRule: own,
    });
    app.save(ratings);

    // ---------- 11. 系统配置（HPS 权重与阈值，提案要求「动态可调」）----------
    const config = new Collection({
      type: "base",
      name: "app_config",
      fields: [
        { name: "key", type: "text", required: true },
        { name: "value", type: "json" },
        { name: "description", type: "text" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: authed,
      viewRule: authed,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    app.save(config);
  },
  (app) => {
    // 回滚：删除全部自定义集合
    for (const name of [
      "checkins",
      "physio_records",
      "stress_scores",
      "interventions",
      "intervention_logs",
      "kb_entries",
      "qa_sessions",
      "posts",
      "comments",
      "ratings",
      "app_config",
    ]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        // 忽略不存在的集合
      }
    }
  }
);

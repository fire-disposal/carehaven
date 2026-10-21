/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 语音合成（豆包 Seed TTS 2.0，HTTP 单向流式）
//
// 直接复用 另一项目 / 另一实现 使用的 v3 凭据：X-Api-Key + Resource-Id。
// 不走 WebSocket，因为 PocketBase JSVM 没有 WebSocket 客户端；官方 HTTP 单向流式
// 接口返回 HTTP Chunked JSON，每段 data 是 base64 音频，正好由 $http.send 收齐后
// 交给客户端拼接播放。
//
// 密钥只存在服务端环境变量，绝不下发客户端。
// JSVM 处理器是独立运行时：常量必须写在处理器内部。
// ---------------------------------------------------------------------------

routerAdd(
  'GET',
  '/api/zz/tts/status',
  function (e) {
    return e.json(200, {
      available: String($os.getenv('VOLC_TTS_API_KEY') || '').length > 0,
    })
  },
  $apis.requireAuth()
)

routerAdd(
  'POST',
  '/api/zz/tts',
  function (e) {
    const TTS_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
    const MAX_TEXT = 200
    const apiKey = String($os.getenv('VOLC_TTS_API_KEY') || '')
    if (apiKey.length === 0) {
      return e.json(503, { message: '语音功能暂未开通' })
    }

    const info = e.requestInfo()
    const body = info.body || {}
    const text = String(body.text || '').trim()
    if (text.length === 0) {
      return e.badRequestError('缺少要朗读的文字', null)
    }
    if (text.length > MAX_TEXT) {
      return e.badRequestError('一次最多朗读 ' + MAX_TEXT + ' 个字', null)
    }

    const model = String($os.getenv('VOLC_TTS_MODEL') || 'seed-tts-2.0-standard')
    const speaker = String($os.getenv('VOLC_TTS_SPEAKER') || 'zh_female_vv_uranus_bigtts')
    const sampleRate = Number($os.getenv('VOLC_TTS_SAMPLE_RATE') || 24000)
    const resourceId = String($os.getenv('VOLC_TTS_RESOURCE_ID') || 'seed-tts-2.0')

    // 缓存键包含所有会影响音频的输入：同一段文字、同一音色只合成一次。
    // 缓存文件只存音频分片与元数据，不存用户身份；问答内容是公开知识库回答。
    const cacheKey = $security.sha256(
      [text, model, speaker, String(sampleRate), resourceId, 'mp3'].join('\n')
    )
    const cacheDir = $app.dataDir() + '/tts-cache'
    const cacheFile = cacheDir + '/' + cacheKey + '.json'

    try {
      const cachedRaw = $os.readFile(cacheFile)
      const cached = JSON.parse(
        typeof cachedRaw === 'string' ? cachedRaw : toString(cachedRaw)
      )
      if (Array.isArray(cached.chunks) && cached.chunks.length > 0) {
        return e.json(200, {
          chunks: cached.chunks,
          contentType: 'audio/mpeg',
          chars: text.length,
          cached: true,
        })
      }
    } catch (err) {
      // 未命中或文件损坏：继续合成；缓存问题不能阻断朗读
    }

    const payload = {
      req_params: {
        text: text,
        model: model,
        speaker: speaker,
        audio_params: {
          format: 'mp3',
          sample_rate: sampleRate,
        },
      },
    }

    let response
    try {
      response = $http.send({
        url: TTS_URL,
        method: 'POST',
        timeout: 40,
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
          'X-Api-Resource-Id': resourceId,
          'X-Api-Request-Id': $security.randomString(32),
        },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      $app.logger().error('TTS 请求失败', 'error', String(err))
      return e.json(502, { message: '语音合成暂时不可用，请稍后再试' })
    }

    if (response.statusCode !== 200) {
      $app.logger().warn('TTS 上游返回异常', 'status', response.statusCode)
      return e.json(502, { message: '语音合成暂时不可用，请稍后再试' })
    }

    const raw = typeof response.raw === 'string' ? response.raw : toString(response.body)
    const chunks = []

    // HTTP Chunked 响应是多个 JSON 对象直接拼接；逐字符扫描出每个对象的边界，
    // 不依赖分隔符，也不会被 base64 里可能出现的字符干扰。
    let depth = 0
    let inString = false
    let escaped = false
    let start = -1
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === '{') {
        if (depth === 0) start = i
        depth += 1
        continue
      }
      if (ch === '}') {
        depth -= 1
        if (depth === 0 && start >= 0) {
          chunks.push(raw.slice(start, i + 1))
          start = -1
        }
      }
    }

    const audio = []
    for (let i = 0; i < chunks.length; i += 1) {
      let obj
      try {
        obj = JSON.parse(chunks[i])
      } catch (err) {
        continue
      }
      if (obj.code !== undefined && obj.code !== 0 && obj.code !== 20000000) {
        $app.logger().warn('TTS 返回错误码', 'code', obj.code)
        return e.json(502, { message: '语音合成失败，请稍后再试' })
      }
      if (typeof obj.data === 'string' && obj.data.length > 0) {
        audio.push(obj.data)
      }
    }

    if (audio.length === 0) {
      return e.json(502, { message: '没有取到语音，请稍后再试' })
    }

    try {
      $os.mkdirAll(cacheDir, 493)
      $os.writeFile(
        cacheFile,
        JSON.stringify({
          chunks: audio,
          contentType: 'audio/mpeg',
          chars: text.length,
          createdAt: new Date().toISOString(),
        }),
        420
      )
    } catch (err) {
      // 音频已经拿到：写不进缓存只是下次再合成一次，不能把这次成功变成失败
      $app.logger().warn('TTS 缓存写入失败', 'error', String(err))
    }

    return e.json(200, {
      chunks: audio,
      contentType: 'audio/mpeg',
      chars: text.length,
      cached: false,
    })
  },
  $apis.requireAuth()
)

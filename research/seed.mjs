#!/usr/bin/env bun
// 种子数据：通过真实 HTTP 接口造一小组可研究的样本（开发/演示/回放验证用）。
//
// 与旧的 seed 迁移不同：这里走完整链路（注册 → 同意 → 打卡 → 生理 → 互助），
// 因此会真实触发评分重算与事件落库，不会往生产库塞 demo 账号（脚本只在本地跑）。
//
// 用法：
//   bun research/seed.mjs --base http://127.0.0.1:8196 --users 3 --rounds 2
//
// 生成账号：seed1@example.com … seedN@example.com / 密码 SeedDemo123
//
// 注意：打卡与生理数据都走 /api/zz/*，date 由服务端取当前时间，不能造历史日期。
// 「-days」已移除：一天多轮打卡用 --rounds 表达，历史数据靠真实时间积累。

function parseArgs(argv) {
  const args = { base: 'http://127.0.0.1:8090', users: 2, rounds: 2 }
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]
    if (k === '--base') args.base = argv[++i]
    else if (k === '--users') args.users = Number(argv[++i])
    else if (k === '--rounds') args.rounds = Number(argv[++i])
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const PASSWORD = 'SeedDemo123'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function post(path, body, token) {
  const res = await fetch(`${args.base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch (err) {
    json = null
  }
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${text.slice(0, 160)}`)
  }
  return json
}

async function ensureUser(index) {
  const email = `seed${index}@example.com`
  try {
    await post('/api/collections/users/records', {
      email,
      password: PASSWORD,
      passwordConfirm: PASSWORD,
      name: `种子${index}`,
    })
  } catch (err) {
    // 已存在就继续（幂等）
    if (!String(err.message).includes('400')) throw err
  }
  const auth = await post('/api/collections/users/auth-with-password', {
    identity: email,
    password: PASSWORD,
  })
  return { email, token: auth.token, id: auth.record.id }
}

const MOODS = [4, 3, 2, 5, 3]
const ANXIETY = [3, 6, 8, 2, 5]
const FATIGUE = [4, 7, 9, 3, 6]

for (let i = 1; i <= args.users; i += 1) {
  const user = await ensureUser(i)
  await post('/api/zz/research/consent', { granted: true }, user.token)

  for (let round = 0; round < args.rounds; round += 1) {
    const mood = MOODS[round % MOODS.length]
    const anxiety = ANXIETY[(round + i) % ANXIETY.length]
    const fatigue = FATIGUE[(round + i) % FATIGUE.length]
    try {
      await post(
        '/api/zz/checkins',
        {
          period: round % 2 === 0 ? 'morning' : 'evening',
          mood,
          anxiety,
          fatigue,
          sleep_hours: 5 + (i % 3),
          care_hours: 6 + (round % 5),
        },
        user.token
      )
    } catch (err) {
      console.warn(`  checkin ${i}/${round}: ${err.message}`)
    }

    // 与事件错开几十毫秒，避免数据与事件同毫秒写入被回放归为 timing
    await sleep(80)

    // 首轮补一条手动生理数据，制造「有采集 / 缺采集」混合
    if (round === 0) {
      try {
        await post(
          '/api/zz/physio/manual',
          {
            hrv: 30 + i * 4,
            gsr: 4 + (round % 3),
            sleep_quality: 55 + i * 5,
            steps: 3000 + round * 700,
          },
          user.token
        )
      } catch (err) {
        console.warn(`  physio ${i}/${round}: ${err.message}`)
      }
      await sleep(80)
    }
  }

  try {
    await post(
      '/api/zz/whispers',
      {
        kind: i % 2 === 0 ? '求助' : '分享',
        terms: { scene: 'night_wander', feeling: 'exhausted', tried: 'night_light', wish: 'anyone_else' },
        anonymous: i % 2 === 0,
      },
      user.token
    )
  } catch (err) {
    console.warn(`  whisper ${i}: ${err.message}`)
  }

  console.log(`[seed] ${user.email} 完成（${args.rounds} 轮打卡）`)
}

console.log('')
console.log('[seed] 下一步：')
console.log('  bun research/replay.mjs --db <pb_data>/data.db')
console.log(`  RESEARCH_HMAC_SECRET=dev-secret bun research/dataset.mjs --db <pb_data>/data.db --out research/out/dev`)

// node --test packages/bot/test/*.test.mjs
// 本机起同步服务 + 模拟一台 App 设备的快照，跑机器人的完整流程；Telegram / 飞书用假的接口服务器
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'sayday-bot-'))
process.env.DATA_DIR = join(tmp, 'sync')
process.env.MIN_FREE_MB = '1'
const { handler } = await import('../../sync-server/server.mjs')
const srv = http.createServer(handler).listen(0, '127.0.0.1')
await new Promise((r) => srv.once('listening', r))
const API = `http://127.0.0.1:${srv.address().port}/api/sync`

const { deriveKeys, seal, open } = await import('../crypto.mjs')
const { createBot, Store, makeQuestions } = await import('../core.mjs')
const { telegram } = await import('../adapters/telegram.mjs')
const { feishu } = await import('../adapters/feishu.mjs')

// 词表：几个词，排名相近好出干扰项
const W = (w, rank, zh) => ({ w, rank, zh, ipa: '', sensitive: false })
const words = [W('apple', 500, 'n. 苹果'), W('river', 510, 'n. 河流'), W('chair', 520, 'n. 椅子'), W('table', 530, 'n. 桌子'), W('happy', 540, 'a. 快乐的')]
const sents = [{ en: 'I ate a green apple after lunch today.', zh: '我今天午饭后吃了个青苹果。', cefr: 'A2', words: ['apple'] }]
const content = { words, byWord: new Map(words.map((w) => [w.w, w])), sents, sentsByWord: new Map([['apple', sents]]) }

const CODE = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-23'
const card = (word, reps, due) => ({ word, due, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps, lapses: 0, state: 2, last_review: due - 86400_000, added: 1, known: 0 })
const { id, key } = await deriveKeys(CODE)
const APP = 'a'.repeat(32)
await fetch(`${API}/v1/a/${id}/d/${APP}`, { method: 'PUT', body: await seal({ v: 1, dev: APP, ts: Date.now(), tables: { card: [card('apple', 0, 1000), card('river', 3, 2000)] }, kv: { profile: { v: JSON.stringify({ goal: { kind: 'ielts' } }), ts: 1 } } }, key) })

const store = new Store(join(tmp, 'bot'))
const bot = createBot({ api: API, store, content, tz: 480, decode: async () => new Float32Array(16000), score: async (_a, text) => ({ score: 76, words: text.split(' ').map((w, i) => ({ word: w, level: i === 1 ? 'r' : 'g' })) }) })

test('出题：生词 3 选 1、熟词拼写', () => {
  const qs = makeQuestions([card('apple', 0, 1), card('river', 3, 2)], content.byWord, words, 3, () => 0.2)
  assert.equal(qs[0].kind, 'choice'); assert.ok(qs[0].options.includes('苹果')); assert.equal(qs[0].options.length, 3)
  assert.equal(qs[1].kind, 'spell'); assert.equal(qs[1].answer, 'river')
})

test('没绑定先给说明；码不对拒绝；码对了绑上', async () => {
  assert.match((await bot.handle('tg:1', { text: '你好' }))[0].text, /绑定方法/)
  assert.match((await bot.handle('tg:1', { text: '绑定 123' }))[0].text, /同步码不对/)
  const r = await bot.handle('tg:1', { text: '绑定 ' + CODE.toLowerCase() })
  assert.match(r[0].text, /绑好了：找到 2 个词卡/)
})

test('复习：按钮答选择题、回复英文答拼写，记进复习并传回同步服务', async () => {
  const r = await bot.handle('tg:1', { text: '复习' })
  assert.match(r[0].text, /第 1\/2 题　“apple”是什么意思/)
  const right = r[0].buttons.find((b) => b.label === '苹果')
  const a1 = await bot.handle('tg:1', { action: right.data })
  assert.match(a1[0].text, /✓ 对了：apple = 苹果/)
  assert.match(a1[1].text, /拼出这个词：河流/)
  const a2 = await bot.handle('tg:1', { text: 'rivr' })
  assert.match(a2[0].text, /✗ 正确答案：river/)
  assert.match(a2[1].text, /这一轮 2 题对了 1 题/)
  // 旧按钮再点：不重复记
  assert.match((await bot.handle('tg:1', { action: right.data }))[0].text, /已经答过了/)
  // 机器人作为一台设备传上去的快照：两条复习记录，apple 复习后排到以后
  const { devices } = await (await fetch(`${API}/v1/a/${id}`)).json()
  const botDev = devices.find((d) => d.dev !== APP)
  const snap = await open(new Uint8Array(await (await fetch(`${API}/v1/a/${id}/d/${botDev.dev}`)).arrayBuffer()), key)
  assert.equal(snap.tables.review_log.length, 2)
  assert.deepEqual(snap.tables.review_log.map((x) => x.rating), [3, 1])
  assert.ok(snap.tables.card.find((c) => c.word === 'apple').due > Date.now())
  assert.equal(Object.values(snap.tables.day)[0]?.reviews ?? snap.tables.day[0].reviews, 2)
})

test('跟读：给一句、发语音打分', async () => {
  assert.match((await bot.handle('tg:1', { text: '跟读' }))[0].text, /I ate a green apple/)
  const r = await bot.handle('tg:1', { voice: async () => Buffer.from('OggS') })
  assert.match(r[0].text, /跟读 76 分/); assert.match(r[0].text, /没读准：ate/)
})

test('改推送时间、到点推送、同一天不重复推', async () => {
  assert.match((await bot.handle('tg:1', { text: '时间 08:05' }))[0].text, /08:05/)
  const sent = []
  const at = Date.UTC(2026, 9, 16, 0, 10) // 北京时间 08:10
  await bot.tick(async (c, m) => sent.push([c, m.text]), at)
  assert.equal(sent[0][0], 'tg:1'); assert.match(sent[0][1], /今天的复习来了/)
  assert.ok(sent.some(([, t]) => /跟读这句/.test(t)))
  const n = sent.length
  await bot.tick(async (c, m) => sent.push([c, m.text]), at + 60_000)
  assert.equal(sent.length, n)
})

test('解绑', async () => {
  assert.match((await bot.handle('tg:1', { text: '解绑' }))[0].text, /已解绑/)
  assert.match((await bot.handle('tg:1', { text: '复习' }))[0].text, /绑定方法/)
})

test('Telegram 适配：按钮变成 inline keyboard、回调和语音转成消息', async () => {
  const calls = []
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      calls.push([req.url, b])
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url.endsWith('/getFile')) return res.end(JSON.stringify({ ok: true, result: { file_path: 'voice/1.oga' } }))
      if (req.url.includes('/file/')) return res.end('OggS....')
      res.end(JSON.stringify({ ok: true, result: true }))
    })
  }).listen(0, '127.0.0.1')
  await new Promise((r) => fake.once('listening', r))
  const t = telegram({ token: 'T', base: `http://127.0.0.1:${fake.address().port}`, onMessage: async () => [] })
  await t.send('tg:42', { text: 'hi', buttons: [{ label: '苹果', data: 'a:0:1' }] })
  const body = JSON.parse(calls[0][1])
  assert.equal(calls[0][0], '/botT/sendMessage'); assert.equal(body.chat_id, '42'); assert.deepEqual(body.reply_markup.inline_keyboard, [[{ text: '苹果', callback_data: 'a:0:1' }]])
  assert.deepEqual(await t.dispatch({ callback_query: { id: 'q', data: 'a:0:1', message: { chat: { id: 42 } } } }), { chat: 'tg:42', msg: { action: 'a:0:1' } })
  const v = await t.dispatch({ message: { chat: { id: 42 }, voice: { file_id: 'F' } } })
  assert.equal((await v.msg.voice()).toString().slice(0, 4), 'OggS')
  fake.close()
})

test('飞书适配：校验 token、URL 验证、消息和卡片按钮转成消息', async () => {
  const f = feishu({ appId: 'a', appSecret: 's', verifyToken: 'VT', onMessage: async () => [] })
  assert.deepEqual(f.parse({ header: { event_type: 'im.message.receive_v1' }, event: { message: { chat_id: 'oc_1', message_type: 'text', content: JSON.stringify({ text: '@_user_1 复习' }) } } }), { chat: 'fs:oc_1', msg: { text: '复习' } })
  assert.deepEqual(f.parse({ header: { event_type: 'card.action.trigger' }, event: { action: { value: { data: 'a:1:2' } }, context: { open_chat_id: 'oc_1' } } }), { chat: 'fs:oc_1', msg: { action: 'a:1:2' } })
  const s = http.createServer(f.handler).listen(0, '127.0.0.1')
  await new Promise((r) => s.once('listening', r))
  const u = `http://127.0.0.1:${s.address().port}/`
  const post = (b) => fetch(u, { method: 'POST', body: JSON.stringify(b) })
  assert.deepEqual(await (await post({ type: 'url_verification', token: 'VT', challenge: 'xyz' })).json(), { challenge: 'xyz' })
  assert.equal((await post({ type: 'url_verification', token: 'bad', challenge: 'xyz' })).status, 403)
  assert.equal((await post({ header: { token: 'bad' } })).status, 403)
  assert.equal((await post({ encrypt: '...' })).status, 400)
  s.close()
})

test.after(() => { srv.close(); rmSync(tmp, { recursive: true, force: true }) })

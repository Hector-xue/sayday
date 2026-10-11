// node --test：微信语音（silk）解码打分、MCP（stdio / HTTP）连通、HTTP 鉴权
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { encode } from 'silk-wasm'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { toolByName } from '../tools.mjs'
import { resample } from '../core.mjs'

const here = new URL('../', import.meta.url).pathname
const WAV = new URL('../../../site/assets/audio/us-c4bb9900be.wav', import.meta.url).pathname
const TEXT = 'I think three things are worth thanking for'

test('微信语音（silk）和原始 WAV 打分基本一致', async () => {
  const wav = readFileSync(WAV)
  const a = await toolByName.get('score_pronunciation').run({ audio: WAV, text: TEXT })
  // 取 WAV 的 PCM → 24k → silk（微信同款编码）→ base64 交给工具
  const pcm = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length))
  const rate = wav.readUInt32LE(24)
  const f = resample(Float32Array.from(pcm, (v) => v / 32768), rate, 24000)
  const s16 = Int16Array.from(f, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767))))
  const silk = await encode(Buffer.from(s16.buffer), 24000)
  const b = await toolByName.get('score_pronunciation').run({ audio: Buffer.from(silk.data).toString('base64'), text: TEXT })
  assert.ok(a.score >= 80, `WAV ${a.score}`)
  assert.ok(Math.abs(a.score - b.score) <= 8, `WAV ${a.score} / silk ${b.score}`)
})

test('读错的句子：分数明显低，并指出词', async () => {
  // 用示范音频去对一句完全不同的话
  const r = await toolByName.get('score_pronunciation').run({ audio: WAV, text: 'She sells sea shells by the sea shore' })
  assert.ok(r.score < 60, `${r.score}`)
  assert.ok(r.words.length >= 3)
})

test('MCP stdio：列工具、调用查词', async () => {
  const c = new Client({ name: 't', version: '0' })
  await c.connect(new StdioClientTransport({ command: 'node', args: [here + 'cli.mjs', 'mcp'] }))
  const { tools } = await c.listTools()
  assert.ok(tools.some((t) => t.name === 'score_pronunciation'))
  const r = await c.callTool({ name: 'lookup_word', arguments: { word: 'umbrella' } })
  assert.equal(r.structuredContent.found, true)
  const bad = await c.callTool({ name: 'episode', arguments: { n: 99 } })
  assert.equal(bad.isError, true)
  await c.close()
})

test('HTTP：没 Token 401；MCP 和 REST 都能用', async () => {
  const token = 'test-token-1234567890'
  const p = spawn('node', [here + 'cli.mjs', 'http', '18791'], { env: { ...process.env, SAYDAY_TOKEN: token }, stdio: ['ignore', 'ignore', 'pipe'] })
  await new Promise((r) => p.stderr.once('data', r))
  try {
    assert.equal((await fetch('http://127.0.0.1:18791/api/lookup_word', { method: 'POST', body: '{"word":"cat"}' })).status, 401)
    const ok = await fetch('http://127.0.0.1:18791/api/lookup_word', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{"word":"cat"}' })
    assert.equal((await ok.json()).word, 'cat')
    const c = new Client({ name: 't', version: '0' })
    await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:18791/mcp'), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
    const r = await c.callTool({ name: 'daily_words', arguments: { level: 'B1', count: 3, goal: 'ielts' } })
    assert.equal(r.structuredContent.words.length, 3)
    await c.close()
  } finally { p.kill() }
})

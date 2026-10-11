// 示范音频包：content/pack 里的例句 + 单词 → Kokoro 合成 → mp3（32kbps 单声道）
// 输出 <out>/<accent>/s/<Tatoeba句号>.mp3 与 <out>/<accent>/w/<单词>.mp3，外加 <out>/<accent>/shard-<i>.json（清单）
// 用法: node build_audio.mjs --accent us --shard 0 --shards 20 --out out [--dtype q8] [--limit 10]
// 没有 ffmpeg 时输出 wav（只用于本地验证；CI 里装 ffmpeg 出 mp3）
import { KokoroTTS } from 'kokoro-js'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const accent = arg('accent', 'us')
const shard = Number(arg('shard', 0))
const shards = Number(arg('shards', 1))
const out = arg('out', 'out')
const dtype = arg('dtype', 'q8')
const limit = Number(arg('limit', 0))
const VOICE = { us: 'af_heart', gb: 'bf_emma' }[accent]
const pack = new URL('../pack/', import.meta.url)
const words = JSON.parse(readFileSync(new URL('words.json', pack)))
const sents = JSON.parse(readFileSync(new URL('sentences.json', pack)))

// 先句子后单词；按下标取模分片，每片的难度分布一致
const items = [
  ...sents.map((s) => ({ kind: 's', key: String(s[0]), text: s[1] })),
  ...words.map((w) => ({ kind: 'w', key: w[0], text: w[0] })),
].filter((_, i) => i % shards === shard)
const todo = limit ? items.slice(0, limit) : items
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const ext = hasFfmpeg ? 'mp3' : 'wav'
for (const k of ['s', 'w']) mkdirSync(join(out, accent, k), { recursive: true })

function wav16(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  return b
}

// 去掉首尾静音（留 80ms），单词音频尤其明显
function trim(a, rate) {
  const th = 0.01, pad = Math.round(rate * 0.08)
  let s = 0, e = a.length - 1
  while (s < a.length && Math.abs(a[s]) < th) s++
  while (e > s && Math.abs(a[e]) < th) e--
  return a.subarray(Math.max(0, s - pad), Math.min(a.length, e + pad))
}

const t0 = Date.now()
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype, device: 'cpu' })
console.log(`载入 ${Date.now() - t0}ms · ${accent} 第 ${shard + 1}/${shards} 片 · ${todo.length} 条 · ${ext}`)
const manifest = []
let audioSec = 0, i = 0
for (const it of todo) {
  const file = join(out, accent, it.kind, `${it.kind === 'w' ? encodeURIComponent(it.key) : it.key}.${ext}`)
  if (existsSync(file)) { i++; continue }
  const a = await tts.generate(it.text, { voice: VOICE, speed: it.kind === 'w' ? 0.9 : 0.95 })
  const pcm = trim(a.audio, a.sampling_rate)
  const wav = wav16(pcm, a.sampling_rate)
  if (hasFfmpeg) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '32k', '-y', file], { input: wav })
    if (r.status !== 0) throw new Error('ffmpeg 失败：' + r.stderr)
  } else writeFileSync(file, wav)
  const sec = pcm.length / a.sampling_rate
  audioSec += sec
  manifest.push([it.kind, it.key, +sec.toFixed(2)])
  if (++i % 200 === 0) console.log(`${i}/${todo.length} · 音频 ${Math.round(audioSec)}s · 用时 ${Math.round((Date.now() - t0) / 1000)}s`)
}
writeFileSync(join(out, accent, `shard-${shard}.json`), JSON.stringify(manifest))
console.log(`完成 ${manifest.length} 条 · 音频 ${Math.round(audioSec)}s · 用时 ${Math.round((Date.now() - t0) / 1000)}s`)

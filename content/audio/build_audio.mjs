// 示范音频包：content/pack 里的例句 + 单词 → Kokoro 合成 → mp3（32kbps 单声道）
// 输出 <out>/<accent>/s/<Tatoeba句号>.mp3、<out>/<accent>/w/<单词>.mp3、<out>/<accent>/e/s<季>e<集>-<行>.mp3（剧集，每个角色自己的声音）、e/l<套>p<部分>-<行>.mp3（雅思听力），
// 外加 <out>/<accent>/shard-<i>.json（清单）
// 用法: node build_audio.mjs --accent us --shard 0 --shards 20 --out out [--dtype q8] [--limit 10] [--only s,w,e,v]（v=剧集主角改名/男声的另几套，也放 e/）
//       [--have have.txt]  增量：线上已有的不再合成（have.txt 每行 <口音>/<目录>/<文件名去扩展名>，scripts/sync-audio.sh 发布时生成在 audio/have.txt）
// 没有 ffmpeg 时输出 wav（只用于本地验证；CI 里装 ffmpeg 出 mp3）
import { KokoroTTS } from 'kokoro-js'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const accent = arg('accent', 'us')
const shard = Number(arg('shard', 0))
const shards = Number(arg('shards', 1))
const out = arg('out', 'out')
const dtype = arg('dtype', 'q8')
const limit = Number(arg('limit', 0))
const only = new Set(arg('only', 's,w,e').split(','))
const have = new Set(arg('have', '') ? readFileSync(arg('have', ''), 'utf8').split('\n').filter(Boolean) : [])
const VOICE = { us: 'af_heart', gb: 'bf_emma' }[accent]
const pack = new URL('../pack/', import.meta.url)
const words = JSON.parse(readFileSync(new URL('words.json', pack)))
const sents = JSON.parse(readFileSync(new URL('sentences.json', pack)))

// 剧集（content/episodes/s*.json，每季一个文件）：主角（“我”）的台词跟着口音换声音，其他角色固定用自己的声音
const epDir = new URL('../episodes/', import.meta.url)
const seasons = readdirSync(epDir).filter((f) => /^s\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(new URL(f, epDir))))
// 一集的全部台词和配音键后缀：主线 <行>、分支 c<选项>-<行>、隐藏支线 b-<行>（和 apps/web/src/lib/episodes.ts 的 epLines / bonusLines 一致）
const keyedLines = (ep) => [
  ...ep.lines.map((l, i) => [String(i), l]),
  ...(ep.choice?.options ?? []).flatMap((o, k) => o.lines.map((l, j) => [`c${k}-${j}`, l])),
  ...(ep.bonus?.lines ?? []).map((l, j) => [`b-${j}`, l]),
]
const epItems = seasons.flatMap((season) => season.episodes.flatMap((ep) => keyedLines(ep).map(([k, l]) => {
  const v = season.cast[l.who].voice
  return { kind: 'e', key: `s${season.season}e${ep.id}-${k}`, text: l.en, voice: typeof v === 'string' ? v : v[accent] }
})))

// 主角可以改名、换男声（content/episodes/names.json）：另配几套，同样放 e/ 目录（kind v 只是为了能单独合成）
//   <键>.m          主角的台词换男声
//   <键>.n-<名字>    提到主角名字的台词（别人叫你、你自我介绍）换成这个名字；主角自己说的再配一份男声 <键>.m.n-<名字>
const NAMES = JSON.parse(readFileSync(new URL('../episodes/names.json', import.meta.url)))
const MALE = NAMES.male_voice[accent]
const NAME_RE = /\bLin\b/g
for (const season of seasons) {
  const me = Object.entries(season.cast).find(([, c]) => c.me)?.[0] ?? 'Lin'
  for (const ep of season.episodes) {
    keyedLines(ep).forEach(([k, l]) => {
      const key = `s${season.season}e${ep.id}-${k}`
      const v = season.cast[l.who].voice
      const voice = typeof v === 'string' ? v : v[accent]
      const mine = l.who === me
      if (mine) epItems.push({ kind: 'v', key: `${key}.m`, text: l.en, voice: MALE })
      if (!NAME_RE.test(l.en)) return
      NAME_RE.lastIndex = 0
      for (const n of NAMES.names) {
        const text = l.en.replace(NAME_RE, n)
        const id = n.toLowerCase()
        epItems.push({ kind: 'v', key: `${key}.n-${id}`, text, voice })
        if (mine) epItems.push({ kind: 'v', key: `${key}.m.n-${id}`, text, voice: MALE })
      }
    })
  }
}

// 雅思听力（content/ielts/listening.json）：也放 e/ 目录、跟剧集一起合成和同步；声音固定，不跟口音换；say 是朗读写法
const listening = JSON.parse(readFileSync(new URL('../ielts/listening.json', import.meta.url))).tests
epItems.push(...listening.flatMap((t) => t.parts.flatMap((p) => p.lines.map((l, i) => ({ kind: 'e', key: `l${t.id}p${p.n}-${i}`, text: l.say ?? l.en, voice: p.cast[l.who].voice })))))

// 先句子后单词再剧集；按下标取模分片，每片的难度分布一致
const items = [
  ...sents.map((s) => ({ kind: 's', key: String(s[0]), text: s[1] })),
  ...words.map((w) => ({ kind: 'w', key: w[0], text: w[0] })),
  ...epItems,
].filter((it) => only.has(it.kind))
  .filter((it) => !have.has(`${accent}/${it.kind === 'v' ? 'e' : it.kind}/${it.kind === 'w' ? encodeURIComponent(it.key) : it.key}`))
  .filter((_, i) => i % shards === shard)
const todo = limit ? items.slice(0, limit) : items
// --dry 1：只数条数（核对分片和改动），不载入模型
if (arg('dry', '')) {
  const by = {}
  for (const it of todo) by[it.kind] = (by[it.kind] ?? 0) + 1
  console.log(JSON.stringify({ accent, shard, shards, by, sample: todo.filter((x) => x.kind === 'v').slice(0, 4) }))
  process.exit(0)
}
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const ext = hasFfmpeg ? 'mp3' : 'wav'
for (const k of ['s', 'w', 'e']) mkdirSync(join(out, accent, k), { recursive: true })

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
  const file = join(out, accent, it.kind === 'v' ? 'e' : it.kind, `${it.kind === 'w' ? encodeURIComponent(it.key) : it.key}.${ext}`)
  if (existsSync(file)) { i++; continue }
  const a = await tts.generate(it.text, { voice: it.voice ?? VOICE, speed: it.kind === 'w' ? 0.9 : 0.95 })
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

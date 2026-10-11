// 示范读音，按顺序找：
//  ① 预置句子的音频（tts/samples，随应用缓存）
//  ② 本机缓存（之前下载或合成过的）
//  ③ 音频包：CI 用 Kokoro 预先生成的全部例句 / 单词（sayday.ivyea.com/audio/，下载后存本机缓存）
//  ④ 网页端退路：本机 Kokoro 现场合成（手机上要几秒）
// 课程开始时 prefetch 把接下来要用的提前下好 / 合成好
import { isNative } from './speech/engine'

export type Accent = 'us' | 'gb'
const VOICE: Record<Accent, string> = { us: 'af_heart', gb: 'bf_emma' }
const CACHE = 'sayday-tts-v1'

let index: Promise<Record<string, Record<string, string>>> | null = null
function presets() {
  if (!index) {
    index = fetch('./tts/samples/index.json').then((r) => r.json()).then((idx) => {
      const m: Record<string, Record<string, string>> = {}
      for (const v of Object.values<any>(idx)) m[norm(v.text)] = v
      return m
    }).catch(() => ({}))
  }
  return index
}
const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')
// 音频包地址：网页同站 /audio/；App 里连门户站（公开、带 CORS）
const PACK = isNative ? 'https://sayday.ivyea.com/audio/' : new URL('/audio/', location.href).href
export type Clip = { text: string; sentenceId?: number; word?: string }
const packUrl = (c: Clip, accent: Accent) =>
  c.sentenceId ? `${PACK}${accent}/s/${c.sentenceId}.mp3` : c.word ? `${PACK}${accent}/w/${encodeURIComponent(c.word)}.mp3` : null
const packMiss = new Set<string>()
async function fromPack(c: Clip, accent: Accent): Promise<Blob | null> {
  const url = packUrl(c, accent)
  if (!url || packMiss.has(url)) return null
  try {
    const r = await fetch(url)
    if (!r.ok) { packMiss.add(url); return null }
    return await r.blob()
  } catch { return null }
}
const keyUrl = (text: string, accent: Accent) => new URL(`./tts-cache/${accent}/${encodeURIComponent(norm(text))}.wav`, location.href).href

// ---- 合成队列：一次只合成一句（Worker 单线程），播放请求插队到最前 ----
let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>()
type Job = Clip & { accent: Accent }
const queue: Job[] = []
const inflight = new Map<string, Promise<Blob>>()
let busy = false
let progress: ((got: number, total: number) => void) | null = null
export const onModelProgress = (f: typeof progress) => { progress = f }

function synthRaw(text: string, accent: Accent): Promise<Blob> {
  if (!worker) {
    worker = new Worker(new URL('./tts-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const d = e.data
      if (d.type === 'progress') progress?.(d.got, d.total)
      else if (d.type === 'audio') { waiting.get(d.id)?.resolve(toWav(d.audio, d.rate)); waiting.delete(d.id) }
      else if (d.type === 'error') { waiting.get(d.id)?.reject(new Error(d.error)); waiting.delete(d.id) }
    }
  }
  const id = ++seq
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker!.postMessage({ id, text, voice: VOICE[accent], base: new URL('./', location.href).href }) })
}

async function pump() {
  if (busy) return
  busy = true
  while (queue.length) {
    const job = queue.shift()!
    const k = keyUrl(job.text, job.accent)
    if (await cached(k)) continue
    const packed = await fromPack(job, job.accent)
    if (packed) { await putCache(k, packed); continue }
    if (isNative) continue
    const p = synthRaw(job.text, job.accent).then(async (b) => { await putCache(k, b); return b })
    inflight.set(k, p)
    try { await p } catch { /* 单句失败不影响后面的 */ } finally { inflight.delete(k) }
  }
  busy = false
}

async function cached(url: string): Promise<Blob | null> {
  try { const r = await (await caches.open(CACHE)).match(url); return r ? await r.blob() : null } catch { return null }
}
async function putCache(url: string, b: Blob) {
  try { await (await caches.open(CACHE)).put(url, new Response(b, { headers: { 'content-type': 'audio/wav' } })) } catch {}
}

/** 拿到一句示范读音（Blob 或 URL）。需要现场合成时插到队列最前 */
const asClip = (c: Clip | string): Clip => (typeof c === 'string' ? { text: c } : c)

export async function getAudio(clip: Clip | string, accent: Accent): Promise<string> {
  const c = asClip(clip)
  const text = c.text
  const pre = (await presets())[norm(text)]
  if (pre?.[accent]) return new URL(`./tts/samples/${pre[accent]}`, location.href).href
  const k = keyUrl(text, accent)
  const hit = await cached(k)
  if (hit) return URL.createObjectURL(hit)
  const packed = await fromPack(c, accent)
  if (packed) { await putCache(k, packed); return URL.createObjectURL(packed) }
  if (isNative) throw new Error('这句的示范音频还没下载，请联网后再试')
  if (inflight.has(k)) return URL.createObjectURL(await inflight.get(k)!)
  const i = queue.findIndex((j) => j.text === text && j.accent === accent)
  if (i >= 0) queue.splice(i, 1)
  const p = synthRaw(text, accent).then(async (b) => { await putCache(k, b); return b })
  inflight.set(k, p)
  try { return URL.createObjectURL(await p) } finally { inflight.delete(k) }
}

/** 后台提前下载 / 合成（课程开始时调用） */
export async function prefetch(clips: (Clip | string)[], accent: Accent) {
  const pre = await presets()
  for (const c of clips.map(asClip)) if (!pre[norm(c.text)]?.[accent] && !queue.some((j) => j.text === c.text && j.accent === accent)) queue.push({ ...c, accent })
  pump()
}

// 播放进度广播（跟读句子的卡拉 OK 逐词高亮用）：frac = 播到几成，结束时为 null
type Progress = { text: string; frac: number | null }
const playListeners = new Set<(p: Progress) => void>()
export function onPlayback(f: (p: Progress) => void) { playListeners.add(f); return () => { playListeners.delete(f) } }
const emit = (p: Progress) => playListeners.forEach((f) => f(p))

let current: HTMLAudioElement | null = null
export async function play(clip: Clip | string, accent: Accent, rate = 1): Promise<void> {
  const text = asClip(clip).text
  const url = await getAudio(clip, accent)
  current?.pause()
  const a = new Audio(url)
  a.playbackRate = rate
  current = a
  await a.play()
  let raf = 0
  const tick = () => { if (a.duration) emit({ text, frac: a.currentTime / a.duration }); raf = requestAnimationFrame(tick) }
  if (playListeners.size) tick()
  await new Promise<void>((r) => { a.onended = () => r(); a.onpause = () => r() })
  cancelAnimationFrame(raf)
  emit({ text, frac: null })
}
export const stopAudio = () => current?.pause()

function toWav(samples: Float32Array, rate: number): Blob {
  const n = samples.length
  const b = new DataView(new ArrayBuffer(44 + n * 2))
  const str = (o: number, t: string) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, rate, true)
  b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true)
  return new Blob([b], { type: 'audio/wav' })
}

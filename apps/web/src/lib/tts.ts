// 示范读音，按顺序找：
//  ① 预置句子的音频（tts/samples，随应用缓存）
//  ② 本机缓存（之前下载过的）
//  ③ 音频包：CI 用 Kokoro 预先生成的全部例句 / 单词（sayday.ivyea.com/audio/，下载后存本机缓存）
//  ④ 都没有（现编的句子，或没联网）：用系统语音朗读（speak.ts）
// 浏览器里现场跑 Kokoro 的退路已去掉：kokoro-js 依赖 GPL 的 eSpeak NG，和 MIT 的本项目一起分发不合适；
// 例句、单词全在音频包里，现编的句子交给系统语音
// 课程开始时 prefetch 把接下来要用的提前下好
import { isNative } from './speech/engine'
import { canSpeak, speak, stopSpeak } from './speak'

export type Accent = 'us' | 'gb'
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
export type Clip = { text: string; sentenceId?: number; word?: string; ep?: string }
const packUrl = (c: Clip, accent: Accent) =>
  c.sentenceId ? `${PACK}${accent}/s/${c.sentenceId}.mp3` : c.word ? `${PACK}${accent}/w/${encodeURIComponent(c.word)}.mp3` : c.ep ? `${PACK}${accent}/e/${c.ep}.mp3` : null
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
// 本机缓存的键：一般按文字；剧集的另几套配音（男声 .m、换名字 .n-xxx）文字可能和原版一样，按配音键存，不然会拿到原版的声音
const cacheKey = (c: Clip, accent: Accent) => (c.ep?.includes('.') ? new URL(`./tts-cache/${accent}/e/${c.ep}.mp3`, location.href).href : keyUrl(c.text, accent))

// ---- 下载队列：后台一条条下，播放请求不排队 ----
type Job = Clip & { accent: Accent }
const queue: Job[] = []
let busy = false

async function pump() {
  if (busy) return
  busy = true
  while (queue.length) {
    const job = queue.shift()!
    const k = cacheKey(job, job.accent)
    if (await cached(k)) continue
    const packed = await fromPack(job, job.accent)
    if (packed) await putCache(k, packed)
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

export class NoAudio extends Error {}

/** 已缓存在本机的示范音频条数（设置页显示用） */
export async function cachedAudioCount(): Promise<number> {
  try { return (await (await caches.open(CACHE)).keys()).length } catch { return 0 }
}
/** 清掉缓存的示范音频（之后播放时会重新下载） */
export async function clearAudioCache(): Promise<void> {
  try { await caches.delete(CACHE) } catch { /* 没有缓存接口：本来就没存 */ }
}

export async function getAudio(clip: Clip | string, accent: Accent): Promise<string> {
  const c = asClip(clip)
  const text = c.text
  const pre = c.ep?.includes('.') ? null : (await presets())[norm(text)] // 另几套配音不能拿原版的预置音频顶
  if (pre?.[accent]) return new URL(`./tts/samples/${pre[accent]}`, location.href).href
  const k = cacheKey(c, accent)
  const hit = await cached(k)
  if (hit) return URL.createObjectURL(hit)
  const packed = await fromPack(c, accent)
  if (packed) { await putCache(k, packed); return URL.createObjectURL(packed) }
  throw new NoAudio(c.sentenceId || c.word || c.ep ? '这句的示范音频还没下载，请联网后再试' : '这句没有预生成的示范音频')
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
// 设置里的“示范语速”：乘在每次播放的速度上（“慢速”按钮在这个基础上再放慢）
let speed = 1
export const setSpeed = (s: number) => { speed = s }
export async function play(clip: Clip | string, accent: Accent, rate = 1): Promise<void> {
  const text = asClip(clip).text
  let url: string
  try {
    url = await getAudio(clip, accent)
  } catch (e) {
    // 没有预生成音频：交给系统语音（没联网时的例句也走这里，总比没声音好）
    if (e instanceof NoAudio && canSpeak()) { await speak(text, accent, 0.95 * rate * speed); return }
    throw e
  }
  current?.pause()
  const a = new Audio(url)
  a.playbackRate = rate * speed
  a.preservesPitch = true
  current = a
  await a.play()
  let raf = 0
  const tick = () => { if (a.duration) emit({ text, frac: a.currentTime / a.duration }); raf = requestAnimationFrame(tick) }
  if (playListeners.size) tick()
  await new Promise<void>((r) => { a.onended = () => r(); a.onpause = () => r() })
  cancelAnimationFrame(raf)
  emit({ text, frac: null })
}
export const stopAudio = () => { current?.pause(); stopSpeak() }

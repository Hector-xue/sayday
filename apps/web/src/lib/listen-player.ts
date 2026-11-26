// 听学的播放器。讲解脚本（listen.ts 的 Track）一样，两种播法：
//   安卓 App：交给原生前台播放服务（Listen.kt，Media3）。锁屏、切到后台、关掉这个页面都接着播；
//     通知栏和锁屏有播放控制，耳机 / 蓝牙按键能暂停、切词；来电话自动暂停，拔耳机就停。
//     开播前把要用的音频下到手机上（地铁里没信号也能听），中文用手机自带的中文语音合成。
//   网页 / 电脑版：在页面里一段一段播，浏览器的媒体控制（键盘媒体键、系统播放卡片）也能控制
// 两种播法给页面的状态（PlayState）一样，页面每半秒问一次
import { isNative } from './speech/engine'
import { getAudio, NoAudio, PACK_PUBLIC, type Accent } from './tts'
import { hasVoice, speakLang, stopSpeak } from './speak'
import { logHeard, type Heard, type Seg, type Source, type Track } from './listen'
import { kvGet, kvSet } from './db'

const tauri = (globalThis as any).__TAURI__?.core as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined

export type PlayStatus = 'idle' | 'preparing' | 'playing' | 'paused' | 'ended' | 'error'
export type PlayState = {
  status: PlayStatus
  /** 正在讲第几个词（从 0 开始） */
  index: number
  total: number
  /** 已经准备好（下载、合成完）的词数；网页版不用准备，等于 total */
  ready: number
  word: string
  /** 手机 / 浏览器没有中文语音：中文讲解跳过了 */
  noZh: boolean
  /** 定时关闭的时间（毫秒时间戳），0 = 没定时 */
  sleepAt: number
  error: string
}
export type StartOpts = { accent: Accent; rate: number; loop: boolean }
export type Action = 'play' | 'pause' | 'next' | 'prev' | 'stop'

const IDLE: PlayState = { status: 'idle', index: 0, total: 0, ready: 0, word: '', noZh: false, sleepAt: 0, error: '' }
const LANG: Record<Accent, string> = { us: 'en-US', gb: 'en-GB' }

interface Engine {
  start(tracks: Track[], o: StartOpts): Promise<void>
  control(a: Action): Promise<void>
  seek(index: number): Promise<void>
  sleep(minutes: number): Promise<void>
  setRate(rate: number): Promise<void>
  state(): Promise<PlayState>
  /** 取走播放器记下的“听完的词”（原生服务在后台记的；网页版当场就写库了，返回空） */
  drain(): Promise<Heard[]>
}

// ---------------- 安卓：原生前台播放服务 ----------------

/** 原生那边要完整地址：单词 / 拼读 / 例句都走公开的音频包（单词和拼读的文件名按单词转义） */
export function nativeSeg(s: Seg, accent: Accent): Record<string, unknown> {
  if (s.t === 'gap') return { t: 'gap', ms: s.ms }
  if (s.t === 'say') return { t: 'say', text: s.text, lang: s.lang === 'zh' ? 'zh-CN' : LANG[accent] }
  const url = `${PACK_PUBLIC}${accent}/${s.kind}/${s.kind === 's' ? s.key : encodeURIComponent(s.key)}.mp3`
  return { t: 'audio', url, text: s.text, lang: LANG[accent] }
}

const OLD_APP = '这个版本的 App 还不能后台听，请先到设置里更新到最新版'
const isMissingCommand = (e: unknown) => /not found|not allowed|unknown|未注册|does not exist/i.test(String((e as Error)?.message ?? e))

const nativeEngine: Engine = {
  async start(tracks, o) {
    const payload = tracks.map((t) => ({ w: t.word, title: t.word, sub: [t.ipa && `/${t.ipa}/`, t.gloss].filter(Boolean).join('  '), segs: t.segs.map((s) => nativeSeg(s, o.accent)) }))
    try {
      await tauri!.invoke('plugin:sayday-infer|listen_start', { tracks: JSON.stringify(payload), rate: o.rate, repeat: o.loop })
    } catch (e) {
      throw new Error(isMissingCommand(e) ? OLD_APP : `没能开始播放：${(e as Error)?.message ?? e}`)
    }
  },
  async control(a) { await tauri!.invoke('plugin:sayday-infer|listen_control', { action: a, value: 0 }).catch(() => {}) },
  async seek(index) { await tauri!.invoke('plugin:sayday-infer|listen_control', { action: 'seek', value: index }).catch(() => {}) },
  async sleep(minutes) { await tauri!.invoke('plugin:sayday-infer|listen_control', { action: 'sleep', value: minutes }).catch(() => {}) },
  async setRate(rate) { await tauri!.invoke('plugin:sayday-infer|listen_control', { action: 'rate', value: rate }).catch(() => {}) },
  async state() {
    try {
      const r = await tauri!.invoke('plugin:sayday-infer|listen_state')
      return { ...IDLE, ...r }
    } catch { return { ...IDLE } }
  },
  async drain() {
    try {
      const r = await tauri!.invoke('plugin:sayday-infer|listen_drain')
      const arr = JSON.parse(r?.heard || '[]')
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  },
}

// ---------------- 网页 / 电脑版：页面里一段一段播 ----------------

class WebEngine implements Engine {
  private tracks: Track[] = []
  private o: StartOpts = { accent: 'us', rate: 1, loop: true }
  private i = 0
  private s = 0
  private status: PlayStatus = 'idle'
  /** 每次暂停 / 切词 +1：正在播的那段播完回来发现不对就不往下走 */
  private token = 0
  private el: HTMLAudioElement | null = null
  private wake: (() => void) | null = null
  private gapTimer: ReturnType<typeof setTimeout> | null = null
  private sleepTimer: ReturnType<typeof setTimeout> | null = null
  private sleepAt = 0
  private noZh = false
  private error = ''
  /** 当前这个词已经播了多久（毫秒，不算暂停） */
  private played = 0
  /** 当前这个词从什么时候开始讲（“上一个”：讲了 3 秒以上就从头重讲，刚开始讲就回上一个词，和安卓一致） */
  private t0 = 0

  constructor() {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
    if (!ms) return
    const on = (a: MediaSessionAction, f: () => void) => { try { ms.setActionHandler(a, f) } catch { /* 这个浏览器不支持这个按钮 */ } }
    on('play', () => { this.control('play') })
    on('pause', () => { this.control('pause') })
    on('nexttrack', () => { this.control('next') })
    on('previoustrack', () => { this.control('prev') })
    on('stop', () => { this.control('stop') })
  }

  private audio(): HTMLAudioElement {
    if (!this.el) { this.el = new Audio(); this.el.preservesPitch = true }
    return this.el
  }

  private meta() {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
    if (!ms) return
    const t = this.tracks[this.i]
    try {
      ms.metadata = t && typeof MediaMetadata !== 'undefined' ? new MediaMetadata({ title: t.word, artist: t.gloss || t.ipa, album: '日日说 · 听学' }) : null
      ms.playbackState = this.status === 'playing' ? 'playing' : this.status === 'paused' ? 'paused' : 'none'
    } catch { /* 元数据只是锦上添花 */ }
  }

  /** 停掉正在出声的（音频、系统语音、停顿），让正在 await 的那段马上返回 */
  private hush() {
    this.token++
    if (this.el) { this.el.pause(); this.el.removeAttribute('src') }
    stopSpeak()
    if (this.gapTimer) clearTimeout(this.gapTimer)
    this.gapTimer = null
    const w = this.wake
    this.wake = null
    w?.()
  }

  private async playUrl(url: string, my: number): Promise<boolean> {
    const a = this.audio()
    a.src = url
    a.playbackRate = this.o.rate
    try { await a.play() } catch { return false }
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => { a.onended = a.onerror = a.onpause = null; this.wake = null; resolve(ok) }
      a.onended = () => done(true)
      a.onerror = () => done(false)
      a.onpause = () => done(true)
      this.wake = () => done(true)
      if (my !== this.token) done(true)
    })
  }

  private async playSeg(seg: Seg, my: number) {
    if (seg.t === 'gap') {
      await new Promise<void>((r) => { this.wake = r; this.gapTimer = setTimeout(r, seg.ms / this.o.rate) })
      return
    }
    if (seg.t === 'say') {
      if (seg.lang === 'zh' && this.noZh) return
      // 念不出来不让整轮停下，但要说清楚是哪一段、为什么（页面上显示）
      await speakLang(seg.text, seg.lang === 'zh' ? 'zh-CN' : LANG[this.o.accent], seg.lang === 'zh' ? this.o.rate : 0.95 * this.o.rate)
        .catch((e) => { this.error = `${seg.lang === 'zh' ? '中文' : '英文'}语音没念出来：${(e as Error)?.message ?? e}` })
      return
    }
    let url: string | null = null
    const clip = seg.kind === 'w' ? { text: seg.text, word: seg.key } : seg.kind === 'p' ? { text: seg.text, spell: seg.key } : { text: seg.text, sentenceId: Number(seg.key) }
    try { url = await getAudio(clip, this.o.accent) }
    catch (e) { if (!(e instanceof NoAudio)) throw e }
    if (my !== this.token) return
    const ok = url ? await this.playUrl(url, my) : false
    // 没有这段音频（没联网、音频包里没有这个词）：系统语音顶上，总比没声音好
    if (!ok && my === this.token) await speakLang(seg.text, LANG[this.o.accent], 0.9 * this.o.rate).catch((e) => { this.error = `“${seg.text.slice(0, 30)}”的音频没下载到，系统语音也没念出来：${(e as Error)?.message ?? e}` })
  }

  private async finishTrack(full: boolean) {
    const t = this.tracks[this.i]
    // 听完（或者听了六成以上再切走）才算听过
    if (t && (full || this.s >= t.segs.length * 0.6)) await logHeard([{ w: t.word, ts: Date.now(), sec: this.played / 1000 }]).catch(() => {})
    this.played = 0
  }

  private async run() {
    const my = ++this.token
    while (my === this.token && this.status === 'playing') {
      if (this.i >= this.tracks.length) {
        if (this.o.loop && this.tracks.length) { this.i = 0; this.s = 0 }
        else { this.status = 'ended'; this.i = Math.max(0, this.tracks.length - 1); this.meta(); return }
      }
      const t = this.tracks[this.i]
      if (this.s === 0) { this.meta(); this.t0 = performance.now() }
      if (this.s >= t.segs.length) {
        await this.finishTrack(true)
        if (my !== this.token) return
        this.i++
        this.s = 0
        continue
      }
      const t0 = performance.now()
      try { await this.playSeg(t.segs[this.s], my) } catch { /* 单段出错跳过，不让整轮停下 */ }
      if (my !== this.token) return
      this.played += performance.now() - t0
      this.s++
    }
  }

  async start(tracks: Track[], o: StartOpts) {
    this.hush()
    this.tracks = tracks
    this.o = { ...o }
    this.i = 0
    this.s = 0
    this.played = 0
    this.error = ''
    this.noZh = !(await hasVoice('zh-CN'))
    this.status = tracks.length ? 'playing' : 'ended'
    this.run()
  }

  async control(a: Action) {
    if (a === 'pause') {
      if (this.status !== 'playing') return
      this.status = 'paused'
      this.hush()
      this.meta()
    } else if (a === 'play') {
      if (this.status === 'ended') { this.i = 0; this.s = 0; this.played = 0 }
      if (this.status === 'playing' || !this.tracks.length) return
      this.status = 'playing'
      this.run()
    } else if (a === 'next' || a === 'prev') {
      if (!this.tracks.length) return
      const was = this.status
      this.hush()
      if (a === 'next') { await this.finishTrack(false); this.i = (this.i + 1) % this.tracks.length }
      // 上一个：这个词讲了 3 秒以上就从头重讲，刚开始讲就回到上一个词
      else if (this.s === 0 || performance.now() - this.t0 < 3000) this.i = (this.i - 1 + this.tracks.length) % this.tracks.length
      this.s = 0
      this.played = 0
      this.status = was === 'paused' ? 'paused' : 'playing'
      this.meta()
      if (this.status === 'playing') this.run()
    } else if (a === 'stop') {
      this.hush()
      this.status = 'idle'
      this.tracks = []
      this.sleep(0)
      this.meta()
    }
  }

  async seek(index: number) {
    if (index < 0 || index >= this.tracks.length) return
    const was = this.status
    this.hush()
    this.i = index
    this.s = 0
    this.played = 0
    this.status = was === 'paused' ? 'paused' : 'playing'
    this.meta()
    if (this.status === 'playing') this.run()
  }

  async sleep(minutes: number) {
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    this.sleepTimer = null
    this.sleepAt = 0
    if (minutes > 0) {
      this.sleepAt = Date.now() + minutes * 60_000
      this.sleepTimer = setTimeout(() => { this.sleepAt = 0; this.control('pause') }, minutes * 60_000)
    }
  }

  async setRate(rate: number) {
    this.o.rate = rate
    if (this.el) this.el.playbackRate = rate
  }

  async state(): Promise<PlayState> {
    const t = this.tracks[this.i]
    return { status: this.status, index: this.i, total: this.tracks.length, ready: this.tracks.length, word: t?.word ?? '', noZh: this.noZh, sleepAt: this.sleepAt, error: this.error }
  }

  async drain() { return [] }
}

let web: WebEngine | null = null
/** 当前平台的播放器（全局只有一个：关掉听学页也接着播） */
export function player(): Engine {
  if (isNative && tauri) return nativeEngine
  if (!web) web = new WebEngine()
  return web
}

/** 把原生服务在后台记的“听完的词”写进学习记录（打开听学页、回到今天页时调） */
export async function syncHeard(): Promise<number> {
  const items = await player().drain()
  if (items.length) await logHeard(items)
  return items.length
}

// 这一轮在听的词：关掉听学页、甚至 App 界面被系统回收后（安卓的播放服务还在播）再打开，要能接着显示
export type NowPlaying = { tracks: Track[]; src: Source; at: number }
let now: NowPlaying | null = null
export async function rememberNow(x: NowPlaying | null) {
  now = x
  await kvSet('listen_now', x).catch(() => {})
}
export async function recallNow(): Promise<NowPlaying | null> {
  if (now) return now
  now = await kvGet<NowPlaying | null>('listen_now', null).catch(() => null)
  return now
}

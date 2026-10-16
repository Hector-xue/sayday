// 做题的手感：答对/答错/连对/做完的提示音，连对计数，一组练完的结算。
// 提示音用 WebAudio 现场合成（不占安装包、离线也有），设置里能关（kv 'sfx'）；系统开了“减少动态效果”时连对徽章不弹跳。
import { kvGet, kvSet } from './db'

export type Sfx = 'right' | 'wrong' | 'combo' | 'finish' | 'cheer'

let on = true
let loaded = false
export async function loadSfx() { if (!loaded) { on = await kvGet<boolean>('sfx', true); loaded = true } return on }
export async function setSfx(v: boolean) { on = v; loaded = true; await kvSet('sfx', v) }

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  try {
    const AC = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext
    if (!AC) return null
    ctx ??= new AC()
    if (ctx!.state === 'suspended') ctx!.resume().catch(() => {})
    return ctx
  } catch { return null }
}

/** 一个音：频率、起始（秒，相对现在）、时长、音量、波形 */
type Note = [hz: number, at: number, dur: number, vol?: number, type?: OscillatorType]
const SOUNDS: Record<Sfx, Note[]> = {
  // 上行两个音：叮咚
  right: [[880, 0, 0.09, 0.16], [1318.5, 0.075, 0.16, 0.16]],
  // 低而短，不刺耳（答错不该像被骂）
  wrong: [[233, 0, 0.16, 0.12, 'triangle'], [196, 0.09, 0.2, 0.1, 'triangle']],
  // 连对：三连上行
  combo: [[880, 0, 0.08, 0.14], [1108.7, 0.07, 0.08, 0.14], [1318.5, 0.14, 0.2, 0.16]],
  // 一组做完：大三和弦琶音
  finish: [[523.3, 0, 0.14, 0.14], [659.3, 0.1, 0.14, 0.14], [784, 0.2, 0.14, 0.14], [1046.5, 0.3, 0.4, 0.16]],
  // 里程碑：琶音再往上
  cheer: [[523.3, 0, 0.12, 0.13], [659.3, 0.09, 0.12, 0.13], [784, 0.18, 0.12, 0.13], [1046.5, 0.27, 0.12, 0.14], [1318.5, 0.36, 0.5, 0.16]],
}

export function sfx(kind: Sfx) {
  if (!on) return
  const a = audio()
  if (!a) return
  const t0 = a.currentTime + 0.01
  for (const [hz, at, dur, vol = 0.15, type = 'sine'] of SOUNDS[kind]) {
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = type
    o.frequency.value = hz
    // 快起慢收，没有咔哒声
    g.gain.setValueAtTime(0, t0 + at)
    g.gain.linearRampToValueAtTime(vol, t0 + at + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur)
    o.connect(g).connect(a.destination)
    o.start(t0 + at)
    o.stop(t0 + at + dur + 0.02)
  }
}

/** 一组练习的计分：哪些题算对错、连对、用时、新词、跟读分 */
export type Tally = { right: number; wrong: number; combo: number; best: number; learned: string[]; shadow: number[] }
export const newTally = (): Tally => ({ right: 0, wrong: 0, combo: 0, best: 0, learned: [], shadow: [] })

/** 记一道有对错的题；返回该放的提示音（连对到 5、10、15… 换成连对的音） */
export function hit(t: Tally, ok: boolean): Sfx {
  if (ok) {
    t.right++; t.combo++; t.best = Math.max(t.best, t.combo)
    return t.combo >= 5 && t.combo % 5 === 0 ? 'combo' : 'right'
  }
  t.wrong++; t.combo = 0
  return 'wrong'
}

/** 结算页上的数字 */
export function summary(t: Tally, seconds: number) {
  const n = t.right + t.wrong
  return {
    minutes: Math.max(1, Math.round(seconds / 60)),
    seconds: Math.round(seconds),
    accuracy: n ? Math.round((t.right / n) * 100) : null,
    graded: n,
    best: t.best,
    learned: t.learned,
    shadowAvg: t.shadow.length ? Math.round(t.shadow.reduce((s, x) => s + x, 0) / t.shadow.length) : null,
    shadowBest: t.shadow.length ? Math.max(...t.shadow) : null,
  }
}

/** 结算页的一句话：按正确率和连对说，不夸张、不说教 */
export function verdict(s: ReturnType<typeof summary>): string {
  if (s.accuracy === null) return '这一组完成了'
  if (s.accuracy === 100 && s.graded >= 5) return '全对，一题没错'
  if (s.best >= 10) return `连对 ${s.best} 题，手感正好`
  if (s.accuracy >= 85) return '做得很稳'
  if (s.accuracy >= 60) return '错的那几个，明天会再遇到'
  return '今天的词有点难，错了的会多复习几次'
}

// 入门定级：词汇量快测（LexTALE 思路的 Yes/No 测试）
// 按词频分 8 档，每档抽 7 个真词，混入假词；勾了假词说明在“乱认”，用 (命中 − 误认) / (1 − 误认) 修正。
// 连续两档修正后都低于 15% 就提前结束（后面的档基本也不认识）。
import type { Word } from './content'
import { cefrFromVocab, type Cefr } from './levels'

export const BANDS: [number, number][] = [[1, 500], [501, 1000], [1001, 2000], [2001, 3000], [3001, 4500], [4501, 6000], [6001, 8000], [8001, 12000]]
const PER_BAND = 7
const PSEUDO_PER_BAND = 2

export type Item = { text: string; real: boolean; band: number; zh?: string }
export type Answer = { item: Item; yes: boolean; ms: number }
export type PlacementResult = { vocab: number; cefr: Cefr; falseAlarm: number; bands: { from: number; to: number; known: number }[]; frontier: number; answered: number }

function shuffle<T>(a: T[], rnd: () => number): T[] {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] }
  return b
}

/** 生成题目：按档从易到难，每档里真词假词打乱 */
export function buildItems(words: Word[], pseudo: string[], skip: Set<string>, seed = Date.now()): Item[][] {
  let s = seed % 2147483647 || 1
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647
  const ps = shuffle(pseudo, rnd)
  return BANDS.map(([a, b], bi) => {
    const pool = words.filter((w) => w.rank >= a && w.rank <= b && !skip.has(w.w) && w.w.length > 2)
    const real = shuffle(pool, rnd).slice(0, PER_BAND).map((w) => ({ text: w.w, real: true, band: bi, zh: w.zh }))
    const fake = ps.splice(0, PSEUDO_PER_BAND).map((t) => ({ text: t, real: false, band: bi }))
    return shuffle([...real, ...fake], rnd)
  })
}

/** 这一档做完后要不要提前结束 */
export function shouldStop(answers: Answer[]): boolean {
  const fa = falseAlarm(answers)
  const done = [...new Set(answers.map((a) => a.item.band))].sort((a, b) => a - b)
  if (done.length < 3) return false
  const last2 = done.slice(-2).map((b) => corrected(answers.filter((a) => a.item.band === b && a.item.real), fa))
  return last2.every((k) => k < 0.15)
}

function falseAlarm(answers: Answer[]) {
  const fake = answers.filter((a) => !a.item.real)
  // 加一点先验，避免只看到两三个假词时误认率被算成 0 或 1
  return (fake.filter((a) => a.yes).length + 0.5) / (fake.length + 4)
}
function corrected(real: Answer[], fa: number) {
  if (!real.length) return 0
  const hit = real.filter((a) => a.yes).length / real.length
  return fa >= 0.95 ? 0 : Math.max(0, Math.min(1, (hit - fa) / (1 - fa)))
}

export function scorePlacement(answers: Answer[]): PlacementResult {
  const fa = falseAlarm(answers)
  const bands = BANDS.map(([from, to], bi) => {
    const real = answers.filter((a) => a.item.band === bi && a.item.real)
    // 没测到的高档（提前结束）按 0 算
    return { from, to, known: real.length ? corrected(real, fa) : 0 }
  })
  const vocab = Math.round(bands.reduce((s, b) => s + b.known * (b.to - b.from + 1), 0))
  // 学新词的起点：第一个“认识不到八成”的档
  const fb = bands.find((b) => b.known < 0.8)
  return { vocab, cefr: cefrFromVocab(vocab), falseAlarm: +fa.toFixed(2), bands, frontier: fb ? fb.from : 12000, answered: answers.length }
}

/** 不测、手动选档时的默认起点 */
export function manualPlacement(c: Cefr): PlacementResult {
  const vocab = { 'Pre-A1': 200, A1: 1000, A2: 2000, B1: 3000, B2: 4200, C1: 6500, C2: 9000 }[c]
  return { vocab, cefr: c, falseAlarm: 0, bands: [], frontier: Math.max(1, Math.round(vocab * 0.8)), answered: 0 }
}

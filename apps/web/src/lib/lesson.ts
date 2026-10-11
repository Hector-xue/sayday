// 每日一课：复习（FSRS 到期）+ 新词（从水平边界往后，按目标加权）+ 跟读（今天新词和复习词的例句）
import { db, kvGet, kvSet, today } from './db'
import { loadContent, pickSentence, type Sentence, type Word } from './content'
import { dueWords } from './srs'
import type { Goal, Cefr } from './levels'
import type { Accent } from './tts'
import type { PlacementResult } from './placement'

export type Profile = {
  goal: Goal
  minutes: number
  accent: Accent
  start: Cefr // 定级时的档位（进度从这里算）
  placement: PlacementResult
  createdAt: number
}
export const getProfile = () => kvGet<Profile | null>('profile', null)
export const saveProfile = (p: Profile) => kvSet('profile', p)

// 功能词：太基础、没法做成词卡，学了也是浪费时间，直接当“认识”
const FUNCTION_WORDS = new Set(`a an the be is am are was were been being have has had do does did i me my mine you your yours he him his she her hers it its we us our ours they them their theirs this that these those
and or but if so as of to in on at by for from with about into over under up down out off than then there here what which who whom whose when where why how not no yes all any some each every
can could will would shall should may might must also very just too only own same such both either neither nor one two three`.split(/\s+/))

export const SIZES: Record<number, { review: number; fresh: number; shadow: number }> = {
  10: { review: 20, fresh: 4, shadow: 2 },
  20: { review: 40, fresh: 8, shadow: 3 },
  30: { review: 60, fresh: 12, shadow: 5 },
  45: { review: 90, fresh: 18, shadow: 7 },
}
export const sizeFor = (minutes: number) => SIZES[minutes] ?? SIZES[20]

export type Step =
  | { kind: 'learn'; word: Word; sentence?: Sentence }
  | { kind: 'review'; word: Word; sentence?: Sentence }
  | { kind: 'shadow'; sentence: Sentence; focus?: string }

export type DayRow = { date: string; reviews: number; new_words: number; shadows: number; seconds: number; minimum: number; done: number }
export async function dayRow(date = today()): Promise<DayRow> {
  return (await db.one<DayRow>('SELECT * FROM day WHERE date = ?', [date])) ?? { date, reviews: 0, new_words: 0, shadows: 0, seconds: 0, minimum: 0, done: 0 }
}

async function pickNewWords(p: Profile, n: number, words: Word[]): Promise<Word[]> {
  const have = new Set((await db.all<{ word: string }>('SELECT word FROM card')).map((r) => r.word))
  const from = Math.max(1, p.placement.frontier)
  const cand = words.filter((w) => w.rank >= from && !have.has(w.w) && !FUNCTION_WORDS.has(w.w) && !w.sensitive && w.cmu.length > 0)
  if (p.goal.kind !== 'ielts') return cand.slice(0, n)
  // 雅思目标：在接下来 400 个词的窗口里，带 ielts 标签的优先
  const win = cand.slice(0, 400)
  const tagged = win.filter((w) => w.tags.includes('ielts'))
  const rest = win.filter((w) => !w.tags.includes('ielts'))
  return [...tagged, ...rest, ...cand.slice(400)].slice(0, n)
}

/** 生成今天剩下要做的步骤。minimum = 保底：只复习 5 个词 + 跟读 1 句 */
export async function buildSession(p: Profile, minimum = false): Promise<Step[]> {
  const { words, byWord, sentsByWord } = await loadContent()
  const size = sizeFor(p.minutes)
  const d = await dayRow()
  const reviewLeft = minimum ? 5 : Math.max(0, size.review - d.reviews)
  const freshLeft = minimum ? 0 : Math.max(0, size.fresh - d.new_words)
  const shadowLeft = minimum ? 1 : Math.max(0, size.shadow - d.shadows)

  const due = (await dueWords(reviewLeft)).map((w) => byWord.get(w)).filter(Boolean) as Word[]
  const fresh = await pickNewWords(p, freshLeft, words)
  const used = new Set<number>()
  const sentFor = (w: Word) => { const s = pickSentence(sentsByWord.get(w.w), w.rank, used); if (s) used.add(s.id); return s }

  const learn: Step[] = fresh.map((w) => ({ kind: 'learn', word: w, sentence: sentFor(w) }))
  const review: Step[] = due.map((w) => ({ kind: 'review', word: w, sentence: sentFor(w) }))
  // 跟读：优先今天新词的例句，不够再用复习词的；都没有就按水平挑一句
  const shadowSrc = [...learn, ...review].map((s) => (s as { sentence?: Sentence; word: Word })).filter((s) => s.sentence)
  const shadows: Step[] = shadowSrc.slice(0, shadowLeft).map((s) => ({ kind: 'shadow', sentence: s.sentence!, focus: s.word.w }))
  if (shadows.length < shadowLeft) {
    const { sents } = await loadContent()
    const cap = Math.max(800, p.placement.frontier + 500)
    const pool = sents.filter((s) => s.hard <= cap && !used.has(s.id))
    for (let i = 0; shadows.length < shadowLeft && pool.length; i++) {
      const s = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
      shadows.push({ kind: 'shadow', sentence: s })
    }
  }
  // 顺序：先复习（热身），再学新词，最后跟读；新词穿插在复习之间会打断节奏，这里不穿插
  return [...review, ...learn, ...shadows]
}

export async function markDay(patch: Partial<Pick<DayRow, 'new_words' | 'shadows' | 'seconds'>> & { minimum?: boolean; done?: boolean }) {
  const d = today()
  await db.run('INSERT INTO day(date) VALUES (?) ON CONFLICT(date) DO NOTHING', [d])
  if (patch.new_words) await db.run('UPDATE day SET new_words = new_words + ? WHERE date = ?', [patch.new_words, d])
  if (patch.shadows) await db.run('UPDATE day SET shadows = shadows + ? WHERE date = ?', [patch.shadows, d])
  if (patch.seconds) await db.run('UPDATE day SET seconds = seconds + ? WHERE date = ?', [Math.round(patch.seconds), d])
  if (patch.minimum) await db.run('UPDATE day SET minimum = 1 WHERE date = ?', [d])
  if (patch.done) await db.run('UPDATE day SET done = 1 WHERE date = ?', [d])
}

export async function recentDays(n = 7): Promise<DayRow[]> {
  const out: DayRow[] = []
  for (let i = n - 1; i >= 0; i--) out.push(await dayRow(today(new Date(Date.now() - i * 86400_000))))
  return out
}

/** 跟读结果入库，并累计音素统计（进步页的“弱项”从这里来） */
export async function saveAttempt(sentenceId: number | null, text: string, score: number, phones: [string, number][], tails: string[]) {
  const now = Date.now()
  const items = [{ sql: 'INSERT INTO attempt(sentence_id, text, score, phones, tails, ts) VALUES (?,?,?,?,?,?)', params: [sentenceId, text, score, JSON.stringify(phones), JSON.stringify(tails), now] }]
  for (const [p, s] of phones) items.push({ sql: 'INSERT INTO phoneme_stat(phone, n, sum, bad, last) VALUES (?, 1, ?, ?, ?) ON CONFLICT(phone) DO UPDATE SET n = n + 1, sum = sum + excluded.sum, bad = bad + excluded.bad, last = excluded.last', params: [p, s, s < 1.4 ? 1 : 0, now] as any })
  await db.batch(items)
}

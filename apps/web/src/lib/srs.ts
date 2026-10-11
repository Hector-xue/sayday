// 间隔复习（FSRS，ts-fsrs）：词卡状态存 SQLite，每次评分写 review_log 并累计到当天
import { fsrs, generatorParameters, createEmptyCard, Rating, State, type Card, type Grade } from 'ts-fsrs'
import { db, today } from './db'

export { Rating, State }
const scheduler = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 365, enable_fuzz: true, enable_short_term: true }))

type Row = { word: string; due: number; stability: number; difficulty: number; elapsed_days: number; scheduled_days: number; learning_steps: number; reps: number; lapses: number; state: number; last_review: number | null }

const toCard = (r: Row): Card => ({
  due: new Date(r.due), stability: r.stability, difficulty: r.difficulty, elapsed_days: r.elapsed_days, scheduled_days: r.scheduled_days,
  learning_steps: r.learning_steps, reps: r.reps, lapses: r.lapses, state: r.state as State, last_review: r.last_review ? new Date(r.last_review) : undefined,
})
const params = (c: Card) => [c.due.getTime(), c.stability, c.difficulty, c.elapsed_days, c.scheduled_days, c.learning_steps, c.reps, c.lapses, c.state, c.last_review ? c.last_review.getTime() : null]

/** 新词入库（学的时候调用） */
export async function addCard(word: string, known = false) {
  const c = createEmptyCard(new Date())
  await db.run(
    `INSERT INTO card(word, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, added, known)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(word) DO NOTHING`,
    [word, ...params(c), Date.now(), known ? 1 : 0],
  )
}

/** 评分：忘了 / 模糊 / 记得 / 简单 */
export async function grade(word: string, rating: Grade, ms?: number) {
  const r = await db.one<Row>('SELECT * FROM card WHERE word = ?', [word])
  if (!r) return
  const now = new Date()
  const { card } = scheduler.next(toCard(r), now, rating)
  const d = today()
  await db.batch([
    { sql: 'UPDATE card SET due=?, stability=?, difficulty=?, elapsed_days=?, scheduled_days=?, learning_steps=?, reps=?, lapses=?, state=?, last_review=? WHERE word=?', params: [...params(card), word] },
    { sql: 'INSERT INTO review_log(word, rating, state, ts, ms) VALUES (?,?,?,?,?)', params: [word, rating, r.state, now.getTime(), ms ?? null] },
    { sql: 'INSERT INTO day(date, reviews) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET reviews = reviews + 1', params: [d] },
  ])
  return card
}

/** 预估下次复习间隔（评分按钮下面的小字） */
export async function preview(word: string): Promise<Record<number, string>> {
  const r = await db.one<Row>('SELECT * FROM card WHERE word = ?', [word])
  if (!r) return {}
  const now = new Date()
  const p = scheduler.repeat(toCard(r), now)
  const out: Record<number, string> = {}
  for (const g of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) out[g] = humanize(p[g as Grade].card.due.getTime() - now.getTime())
  return out
}
function humanize(ms: number) {
  const m = ms / 60000
  if (m < 60) return `${Math.max(1, Math.round(m))} 分钟`
  if (m < 60 * 24) return `${Math.round(m / 60)} 小时`
  const d = m / 1440
  if (d < 30) return `${Math.round(d)} 天`
  if (d < 365) return `${Math.round(d / 30)} 个月`
  return `${(d / 365).toFixed(1)} 年`
}

export async function dueWords(limit: number, until = Date.now()) {
  return (await db.all<{ word: string }>('SELECT word FROM card WHERE known = 0 AND due <= ? ORDER BY due LIMIT ?', [until, limit])).map((r) => r.word)
}
export async function dueCount(until = Date.now()) {
  return (await db.one<{ n: number }>('SELECT count(*) n FROM card WHERE known = 0 AND due <= ?', [until]))?.n ?? 0
}
/** 学过（复习过至少一次且没在“学习中”反复忘）的词数 */
export async function learnedCount() {
  return (await db.one<{ n: number }>('SELECT count(*) n FROM card WHERE known = 0 AND state = ?', [State.Review]))?.n ?? 0
}

// 不惩罚的节奏（方案 1.6）：周目标代替日连续、隔久了回来的“欢迎回来”、积压的复习拆成几天
// 一天“亮灯”= 那天做过任何练习（复习 / 新词 / 听力 / 跟读，保底的 2 分钟也算）
import { db, kvGet, kvSet, today } from './db'

export const WEEK_GOAL = 4
/** 隔了这么多天没练再回来，算“回来了” */
export const AWAY_DAYS = 7

type Row = { date: string; reviews: number; new_words: number; shadows: number; listens: number }
const lit = (r: Row) => r.reviews + r.new_words + r.shadows + (r.listens ?? 0) > 0

const parse = (s: string) => new Date(s + 'T12:00:00')
const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d) }
/** 这一周的周一（周一到周日算一周） */
export const weekStart = (s: string) => addDays(s, -((parse(s).getDay() + 6) % 7))
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400_000)

export type Week = { lit: number; goal: number; met: boolean; streak: number; days: { date: string; lit: boolean }[] }

/**
 * 本周亮了几天 + 连续达标几周。连续周数从上周往前数；本周已经达标的也算上
 * （本周还没达标不算断：一周还没过完）
 */
export function weekOf(litDays: Set<string>, now = today()): Week {
  const start = weekStart(now)
  const days = Array.from({ length: 7 }, (_, i) => { const date = addDays(start, i); return { date, lit: litDays.has(date) } })
  const n = days.filter((d) => d.lit).length
  const count = (ws: string) => Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter((d) => litDays.has(d)).length
  let streak = 0
  for (let ws = addDays(start, -7); count(ws) >= WEEK_GOAL; ws = addDays(ws, -7)) streak++
  if (n >= WEEK_GOAL) streak++
  return { lit: n, goal: WEEK_GOAL, met: n >= WEEK_GOAL, streak, days }
}

export async function litDays(limit = 800): Promise<Set<string>> {
  const rows = await db.all<Row>('SELECT date, reviews, new_words, shadows, listens FROM day ORDER BY date DESC LIMIT ?', [limit])
  return new Set(rows.filter(lit).map((r) => r.date))
}

export async function currentWeek(): Promise<Week> {
  return weekOf(await litDays())
}

/** 上一次亮灯离今天几天（今天之前；从没练过 = null） */
export function awayFrom(lit: Set<string>, now = today()): number | null {
  let last: string | null = null
  for (const d of lit) if (d < now && (!last || d > last)) last = d
  return last ? daysBetween(last, now) : null
}

export type Comeback = { away: number; backlog: number; days: number }

/**
 * 隔了 7 天以上回来、今天还没练：返回离开了几天和积压情况（今天页显示“欢迎回来”）。
 * 今天练过一次之后就不再显示
 */
export async function comeback(perDay: number): Promise<Comeback | null> {
  const lit = await litDays()
  if (lit.has(today())) return null
  const away = awayFrom(lit)
  if (away === null || away < AWAY_DAYS) return null
  const backlog = (await db.one<{ n: number }>('SELECT count(*) n FROM card WHERE known = 0 AND due <= ?', [Date.now()]))?.n ?? 0
  return { away, backlog, days: Math.max(1, Math.ceil(backlog / Math.max(1, perDay))) }
}

/**
 * 把积压的到期词摊到接下来几天：最早到期的留在今天，之后每天 perDay 个（按原来的先后）。
 * 只往后推、不改记忆参数——推迟后复习时 FSRS 按真实间隔算，不吃亏。
 * 同一天只摊一次
 */
export async function spreadBacklog(perDay: number, now = Date.now()): Promise<number> {
  const d = today(new Date(now))
  if ((await kvGet<string>('backlog_spread', '')) === d) return 0
  const rows = await db.all<{ word: string }>('SELECT word FROM card WHERE known = 0 AND due <= ? ORDER BY due', [now])
  if (rows.length <= perDay) return 0
  // 第 k 天早上 6 点（过了凌晨 4 点换日，确实算那一天）
  const base = parse(d).getTime() - 6 * 3600_000
  const ops = rows.slice(perDay).map((r, i) => ({ sql: 'UPDATE card SET due = ? WHERE word = ?', params: [base + (Math.floor(i / perDay) + 1) * 86400_000 + i, r.word] }))
  await db.batch(ops)
  await kvSet('backlog_spread', d)
  return ops.length
}

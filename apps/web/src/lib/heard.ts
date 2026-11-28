// 纯听学“听熟了”的统计：听学和每日练习都要用（单独一个文件，免得 listen ↔ lesson 互相引用）
import { db } from './db'

/** 纯听学：一个词在这么多个不同的日子里听完过，就算听熟了，不再排进新的一组 */
export const MASTER_DAYS = 3
export type HeardStat = { days: number; last: number }

/** 每个词在几个不同的日子里听完过、最后一次是什么时候（日子按凌晨 4 点换，和 db.today 一致） */
export async function heardStats(now = new Date()): Promise<Map<string, HeardStat>> {
  // 本地时间的“第几天”：时间戳加上时区偏移、减 4 小时再按天取整（不用 SQLite 的 localtime：浏览器里的 SQLite 不一定知道时区；CAST：参数按浮点传进来时除法不取整）
  const shift = 4 * 3600_000 + now.getTimezoneOffset() * 60_000
  const rows = await db.all<{ word: string; days: number; last: number }>('SELECT word, count(DISTINCT CAST((ts - ?) / 86400000 AS INTEGER)) days, max(ts) last FROM passive_log GROUP BY word', [shift])
  return new Map(rows.map((r) => [r.word, { days: r.days, last: r.last }]))
}

/** 听熟了的词 */
export async function heardMastered(now = new Date()): Promise<Set<string>> {
  const m = await heardStats(now)
  return new Set([...m].filter(([, s]) => s.days >= MASTER_DAYS).map(([w]) => w))
}

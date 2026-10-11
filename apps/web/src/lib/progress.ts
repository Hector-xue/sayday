// 进步：当前水平估计、练习统计、发音弱项
import { db } from './db'
import type { Cefr } from './levels'
import { vocabLevel } from './calibrate'
import type { Profile } from './lesson'

/** 当前水平（词汇）：见 calibrate.ts。保留旧名字给各页面用 */
export async function currentLevel(p: Profile): Promise<{ cefr: Cefr; vocab: number; learned: number }> {
  return vocabLevel(p)
}

export async function stats() {
  const one = async (sql: string, params: unknown[] = []) => (await db.one<{ n: number }>(sql, params))?.n ?? 0
  const [cards, reviews, attempts, days, avg] = await Promise.all([
    one('SELECT count(*) n FROM card WHERE known = 0'),
    one('SELECT count(*) n FROM review_log'),
    one('SELECT count(*) n FROM attempt'),
    one('SELECT count(*) n FROM day WHERE reviews + new_words + shadows > 0'),
    one('SELECT avg(score) n FROM (SELECT score FROM attempt ORDER BY ts DESC LIMIT 20)'),
  ])
  return { cards, reviews, attempts, days, recentScore: avg ? Math.round(avg) : null }
}

/** 发音弱项：平均校准分最低、且练过至少 5 次的音素 */
export async function weakPhones(limit = 5) {
  return db.all<{ phone: string; n: number; avg: number; bad: number }>('SELECT phone, n, sum / n AS avg, bad FROM phoneme_stat WHERE n >= 5 ORDER BY avg ASC LIMIT ?', [limit])
}

/** 跟读分数走势：按天平均 */
export async function scoreTrend(days = 14) {
  const since = Date.now() - days * 86400_000
  return db.all<{ d: string; avg: number; n: number }>("SELECT date(ts / 1000, 'unixepoch', 'localtime') AS d, avg(score) AS avg, count(*) AS n FROM attempt WHERE ts >= ? GROUP BY d ORDER BY d", [since])
}

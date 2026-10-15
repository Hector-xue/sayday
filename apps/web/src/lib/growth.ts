// 进步看得见（方案 1.5）：雅思四项预估、词汇量曲线、能力解锁
// 全部从本机已有的练习记录推出来，不另外考试；界面一律标“预估”
import { db, kvGet, kvSet, today } from './db'
import { vocabLevel, listenLevel } from './calibrate'
import { practiceBand } from './practice'
import { CEFR, type Cefr } from './levels'
import { getProgress, loadSeasons } from './episodes'
import { weekStart } from './rhythm'
import type { Profile } from './lesson'

// ---------------- 雅思四项预估 ----------------

/** CEFR 档 → 雅思分（取对照区间中间偏下，宁可保守） */
const BAND_OF: Record<Cefr, number> = { 'Pre-A1': 2.5, A1: 3, A2: 3.5, B1: 4.5, B2: 6, C1: 7.5, C2: 8.5 }
export const bandOfCefr = (c: Cefr) => BAND_OF[c]

export type Skill = 'l' | 'r' | 'w' | 's'
export const SKILLS: { k: Skill; t: string }[] = [{ k: 'l', t: '听力' }, { k: 'r', t: '阅读' }, { k: 'w', t: '写作' }, { k: 's', t: '口语' }]
export type BandEst = { band: number; from: string }
export type Bands = Record<Skill, BandEst | null>

/** 每一项能用的最好依据：专项练习 > 模考 > 日常练习折算；一项都没有就是 null */
export async function bandEstimate(p: Profile): Promise<Bands> {
  const [lp, rp, ll, lv] = await Promise.all([practiceBand('listening'), practiceBand('reading'), listenLevel(), vocabLevel(p)])
  const w = await db.one<{ band: number }>('SELECT band FROM writing WHERE band IS NOT NULL ORDER BY ts DESC LIMIT 1')
  const mock = await db.one<{ band: number | null; data: string }>('SELECT band, data FROM speaking_test ORDER BY ts DESC LIMIT 1')
  let s: BandEst | null = null
  if (mock?.band != null) s = { band: mock.band, from: '口语模考 · AI 评分' }
  else if (mock) {
    // 没接 AI 的模考：只有流利度和发音两项客观分，取平均当参考
    const d = JSON.parse(mock.data)
    const xs = [d.objective?.fc, d.objective?.p].filter((x): x is number => typeof x === 'number')
    if (xs.length) s = { band: Math.round((xs.reduce((a, x) => a + x, 0) / xs.length) * 2) / 2, from: '口语模考 · 流利度和发音' }
  }
  return {
    l: lp ? { band: lp.band, from: `雅思听力练习 ${lp.n} 题` } : ll.cefr ? { band: BAND_OF[ll.cefr], from: '每日听力折算' } : null,
    r: rp ? { band: rp.band, from: `雅思阅读练习 ${rp.n} 题` } : { band: BAND_OF[lv.cefr], from: '词汇量折算' },
    w: w ? { band: w.band, from: '写作 · AI 评分' } : null,
    s,
  }
}

/** 雅思总分：四项平均，按官方规则取整（x.25 → x.5，x.75 → x+1，其余就近到 .0 / .5） */
export function overallBand(b: number[]): number {
  const m = b.reduce((a, x) => a + x, 0) / b.length
  return Math.round(m * 2 + 1e-9) / 2
}

export type BandWeek = { week: string } & Partial<Record<Skill, number>>

/** 每周存一份四项预估（同一周覆盖），雷达图拿四周前那份做对比 */
export async function snapshotBands(b: Bands, now = today()): Promise<BandWeek[]> {
  const all = await kvGet<BandWeek[]>('band_weeks', [])
  const week = weekStart(now)
  const row: BandWeek = { week }
  for (const { k } of SKILLS) if (b[k]) row[k] = b[k]!.band
  const out = [...all.filter((x) => x.week !== week), row].sort((a, z) => (a.week < z.week ? -1 : 1)).slice(-104)
  await kvSet('band_weeks', out)
  return out
}

// ---------------- 词汇量曲线 ----------------

export type VocabPoint = { ts: number; vocab: number }

/** 定级 / 每周小测的记录 + 每周存的估算 + 现在，按时间排；同一天只留最后一个 */
export async function vocabCurve(p: Profile, now = Date.now()): Promise<VocabPoint[]> {
  const lv = await vocabLevel(p)
  const est = await db.all<{ value: number; ts: number }>("SELECT value, ts FROM level_estimate WHERE skill = 'vocab' AND value IS NOT NULL ORDER BY ts")
  const weeks = await kvGet<{ week: string; vocab: number }[]>('vocab_weeks', [])
  const week = weekStart(today(new Date(now)))
  await kvSet('vocab_weeks', [...weeks.filter((x) => x.week !== week), { week, vocab: lv.vocab }].slice(-104))
  const pts: VocabPoint[] = [
    ...est.map((r) => ({ ts: r.ts, vocab: Math.round(r.value) })),
    ...weeks.filter((x) => x.week !== week).map((x) => ({ ts: new Date(x.week + 'T12:00:00').getTime(), vocab: x.vocab })),
    { ts: now, vocab: lv.vocab },
  ].sort((a, b) => a.ts - b.ts)
  const byDay = new Map<string, VocabPoint>()
  for (const x of pts) byDay.set(today(new Date(x.ts)), x)
  return [...byDay.values()]
}

// ---------------- 能力解锁 ----------------

export type Ctx = {
  vocab: number; listen: Cefr | null; readBand: number | null; mock: boolean
  diaries: number; chats: number; recentScore: number | null; attempts: number; seasonsDone: number[]
}
export type Ability = { id: string; t: string; how: string; ok: (c: Ctx) => boolean }

const atLeast = (c: Cefr | null, min: Cefr) => !!c && CEFR.indexOf(c) >= CEFR.indexOf(min)

/** 用“能做到的事”说进步，不用徽章；how = 还没解锁时告诉你怎么够到 */
export const ABILITIES: Ability[] = [
  { id: 'travel', t: '出国旅游时问路、点餐、办入住', how: '认识约 1500 个词（A2）', ok: (c) => c.vocab >= 1500 },
  { id: 'chat10', t: '用英文和人文字聊上十来句', how: '和 Emma 聊 10 句以上', ok: (c) => c.chats >= 10 },
  { id: 'diary', t: '用英文写一段自己的日记', how: '写 3 篇日记', ok: (c) => c.diaries >= 3 },
  { id: 'clear', t: '大多数句子能读得让人听清楚', how: '跟读 20 句以上，最近平均 80 分', ok: (c) => c.attempts >= 20 && (c.recentScore ?? 0) >= 80 },
  { id: 'daily90', t: '日常对话里九成的词你都认识', how: '认识约 3000 个词', ok: (c) => c.vocab >= 3000 },
  { id: 'london', t: '应付在伦敦租房、办卡、看病这类事', how: '看完剧集第一季', ok: (c) => c.seasonsDone.includes(1) },
  { id: 'bbc6', t: '听懂 BBC 6 Minute English 这类慢速节目', how: '每日听力稳定到 B1', ok: (c) => atLeast(c.listen, 'B1') },
  { id: 'part1', t: '完成一次雅思口语 Part 1 到 Part 3', how: '做一次口语模考', ok: (c) => c.mock },
  { id: 'ielts-read', t: '在规定时间里读完雅思学术文章', how: '雅思阅读练习到 5.5 分', ok: (c) => (c.readBand ?? 0) >= 5.5 },
  { id: 'news', t: '读懂英文新闻的大意', how: '认识约 5000 个词（B2）', ok: (c) => c.vocab >= 5000 },
  { id: 'show', t: '看美剧能跟上大部分对话', how: '听力到 B2，词汇约 5000', ok: (c) => atLeast(c.listen, 'B2') && c.vocab >= 5000 },
  { id: 'nyc', t: '在纽约职场开会、寒暄、谈小费不露怯', how: '看完剧集第四季', ok: (c) => c.seasonsDone.includes(4) },
]

export async function abilityCtx(p: Profile): Promise<Ctx> {
  const one = async (sql: string) => (await db.one<{ n: number }>(sql))?.n ?? 0
  const [lv, ll, rp, seasons, prog] = await Promise.all([vocabLevel(p), listenLevel(), practiceBand('reading'), loadSeasons(), getProgress()])
  const avg = await db.one<{ n: number | null }>('SELECT avg(score) n FROM (SELECT score FROM attempt ORDER BY ts DESC LIMIT 20)')
  return {
    vocab: lv.vocab, listen: ll.cefr, readBand: rp?.band ?? null, mock: (await one('SELECT count(*) n FROM speaking_test')) > 0,
    diaries: await one('SELECT count(*) n FROM diary WHERE result IS NOT NULL'),
    chats: await one("SELECT count(*) n FROM chat WHERE role = 'user'"),
    recentScore: avg?.n ?? null, attempts: await one('SELECT count(*) n FROM attempt'),
    seasonsDone: seasons.filter((s) => s.episodes.every((e) => prog.done[`${s.season}:${e.id}`])).map((s) => s.season),
  }
}

export type AbilityState = { a: Ability; at: number | null }

/** 算一遍能力，新解锁的记下解锁时间（以后不会因为数据波动又“锁上”） */
export async function abilities(p: Profile, now = Date.now()): Promise<AbilityState[]> {
  const c = await abilityCtx(p)
  const got = await kvGet<Record<string, number>>('abilities', {})
  let changed = false
  for (const a of ABILITIES) if (!got[a.id] && a.ok(c)) { got[a.id] = now; changed = true }
  if (changed) await kvSet('abilities', got)
  return ABILITIES.map((a) => ({ a, at: got[a.id] ?? null }))
}

/** 今天页提示用：还没看过的新解锁（看过就记下） */
export async function unseenAbilities(p: Profile): Promise<Ability[]> {
  const st = await abilities(p)
  const seen = new Set(await kvGet<string[]>('abilities_seen', []))
  return st.filter((x) => x.at && !seen.has(x.a.id)).map((x) => x.a)
}
export async function markAbilitiesSeen(ids: string[]) {
  const seen = await kvGet<string[]>('abilities_seen', [])
  await kvSet('abilities_seen', [...new Set([...seen, ...ids])])
}

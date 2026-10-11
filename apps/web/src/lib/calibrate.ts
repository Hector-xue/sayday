// 持续校准（方案 13.5）：水平不靠一次测试定终身
//  - 词汇：定级给出每个词频档“认识几成”；之后每学会一个词就精确加上；每周 1 分钟小测再修正没学过的那部分
//  - 听力：每天的“听音选义”按句子难度统计正确率
//  - 护栏：升档马上显示；降档要连续两次小测都低于当前档才显示，避免一次状态不好就打击人
import { db, kvGet, kvSet, today } from './db'
import { BANDS, type Answer } from './placement'
import { CEFR, cefrFromVocab, type Cefr } from './levels'
import { State } from './srs'
import { loadContent, type Word } from './content'
import type { Profile } from './lesson'

export type VocabState = { bands: number[]; ts: number; source: 'placement' | 'manual' | 'weekly'; lowStreak: number; shown: Cefr }

const bandSize = (i: number) => BANDS[i][1] - BANDS[i][0] + 1
const bandOf = (rank: number) => BANDS.findIndex(([a, b]) => rank >= a && rank <= b)

/** 手动选档时没有分档数据：按词频从常用往后填满 */
export function bandsFromVocab(vocab: number): number[] {
  let left = vocab
  return BANDS.map((_, i) => { const n = Math.min(bandSize(i), Math.max(0, left)); left -= n; return n / bandSize(i) })
}

export function initialState(p: Profile, ts = p.createdAt): VocabState {
  const bands = p.placement.bands.length ? p.placement.bands.map((b) => b.known) : bandsFromVocab(p.placement.vocab)
  return { bands, ts, source: p.placement.answered ? 'placement' : 'manual', lowStreak: 0, shown: p.placement.cefr }
}

export async function vocabState(p: Profile): Promise<VocabState> {
  const s = await kvGet<VocabState | null>('vocab_state', null)
  return s ?? initialState(p)
}
/** 重新定级后从新结果重新开始累计 */
export const resetVocabState = (p: Profile) => kvSet('vocab_state', initialState(p, Date.now()))

/**
 * 词汇量 = 没进过词卡的词按“该档认识几成”估 + 词卡里已经学会 / 标了认识的词逐个算。
 * 这样学会一个词就精确 +1（不会和定级重复计数），小测只修正没学过的那部分。
 */
export function computeVocab(bands: number[], cardsPerBand: number[], learned: number): number {
  return Math.round(bands.reduce((s, k, i) => s + k * Math.max(0, bandSize(i) - cardsPerBand[i]), 0) + learned)
}

/** 学新词的起点：第一个“认识不到八成”的档 */
export const frontierOf = (bands: number[]) => { const i = bands.findIndex((k) => k < 0.8); return i < 0 ? 12000 : BANDS[i][0] }

export type Level = { cefr: Cefr; raw: Cefr; vocab: number; learned: number; frontier: number; state: VocabState }

export async function vocabLevel(p: Profile): Promise<Level> {
  const [{ byWord }, st, cards] = await Promise.all([
    loadContent(), vocabState(p),
    db.all<{ word: string; known: number; state: number }>('SELECT word, known, state FROM card'),
  ])
  const per = BANDS.map(() => 0)
  let learned = 0, learnedNew = 0
  for (const c of cards) {
    const w = byWord.get(c.word)
    if (!w) continue
    const b = bandOf(w.rank)
    if (b >= 0) per[b]++
    if (c.known || c.state === State.Review) { learned++; if (!c.known) learnedNew++ }
  }
  const vocab = computeVocab(st.bands, per, learned)
  const raw = cefrFromVocab(vocab)
  return { cefr: shownLevel(st, raw), raw, vocab, learned: learnedNew, frontier: frontierOf(st.bands), state: st }
}

/** 显示的档位：只会因为证据充分才往下掉 */
export function shownLevel(st: VocabState, raw: Cefr): Cefr {
  return CEFR.indexOf(raw) >= CEFR.indexOf(st.shown) || st.lowStreak >= 2 ? raw : st.shown
}

// ---- 每周小测：1 分钟，夹在每日练习最前面 ----
const WEEK = 7 * 86400_000
export async function weeklyDue(p: Profile, now = Date.now()): Promise<boolean> {
  const st = await vocabState(p)
  if (now - st.ts < WEEK) return false
  // 至少练过 3 天再测（刚装上没东西可校准）
  const days = (await db.one<{ n: number }>('SELECT count(*) n FROM day WHERE reviews + new_words + shadows > 0'))?.n ?? 0
  return days >= 3
}

export type CheckItem = { text: string; real: boolean; band: number; zh?: string }

/** 抽题：边界附近 3 档（最没把握的地方），每档 5 个没学过的真词，再混 3 个假词 */
export function buildCheck(bands: number[], words: Word[], pseudo: string[], skip: Set<string>, rnd = Math.random): CheckItem[] {
  const f = Math.max(0, bands.findIndex((k) => k < 0.8))
  const pick = [...new Set([f - 1, f, f + 1].map((i) => Math.max(0, Math.min(BANDS.length - 1, i))))]
  const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } return b }
  const items: CheckItem[] = []
  for (const bi of pick) {
    const [a, b] = BANDS[bi]
    const pool = words.filter((w) => w.rank >= a && w.rank <= b && !skip.has(w.w) && w.w.length > 2 && !w.sensitive)
    items.push(...shuffle(pool).slice(0, 5).map((w) => ({ text: w.w, real: true, band: bi, zh: w.zh })))
  }
  items.push(...shuffle(pseudo).slice(0, 3).map((t) => ({ text: t, real: false, band: -1 })))
  return shuffle(items)
}

/** 小测结果并进分档：每档各取一半（新旧加权），只动测到的档 */
export function mergeCheck(st: VocabState, answers: Answer[], now = Date.now()): VocabState {
  const fake = answers.filter((a) => !a.item.real)
  const fa = (fake.filter((a) => a.yes).length + 0.5) / (fake.length + 4)
  // 假词只有 3 个，先验压不住：一半以上假词点了“认识”就当这次不可信，分档不动（下周再测）
  if (fake.length && fake.filter((a) => a.yes).length / fake.length > 0.5) return { ...st, ts: now }
  const bands = [...st.bands]
  for (const bi of new Set(answers.filter((a) => a.item.real).map((a) => a.item.band))) {
    const real = answers.filter((a) => a.item.real && a.item.band === bi)
    const hit = real.filter((a) => a.yes).length / real.length
    const k = fa >= 0.95 ? 0 : Math.max(0, Math.min(1, (hit - fa) / (1 - fa)))
    bands[bi] = +(0.5 * bands[bi] + 0.5 * k).toFixed(3)
  }
  return { ...st, bands, ts: now, source: 'weekly' }
}

export async function applyCheck(p: Profile, answers: Answer[]) {
  const before = await vocabLevel(p)
  let st = mergeCheck(before.state, answers)
  if (st.source !== 'weekly' || st.bands === before.state.bands) {
    await kvSet('vocab_state', st)
    return { before: before.vocab, after: before.vocab, cefr: before.cefr, unreliable: true }
  }
  await kvSet('vocab_state', st)
  const after = await vocabLevel(p)
  // 护栏：这次估出来低于当前显示档就记一次，连续两次才真的降
  const low = CEFR.indexOf(after.raw) < CEFR.indexOf(before.cefr)
  st = { ...st, lowStreak: low ? st.lowStreak + 1 : 0, shown: low && st.lowStreak + 1 < 2 ? before.cefr : after.raw }
  await kvSet('vocab_state', st)
  await db.run('INSERT INTO level_estimate(skill, cefr, value, se, source, ts, detail) VALUES (?,?,?,?,?,?,?)', ['vocab', after.raw, after.vocab, null, 'weekly', Date.now(), JSON.stringify(st.bands)])
  return { before: before.vocab, after: after.vocab, cefr: shownLevel(st, after.raw), unreliable: false }
}

// ---- 听力：听音选义的正确率按句子难度档统计 ----
export type ListenLevel = { cefr: Cefr | null; n: number; acc: number }
const LISTEN_MIN = 6

/** 最高的“答了至少 6 题、正确率 ≥ 70%”的档；更低的档默认也会 */
export function listenLevelFrom(rows: { cefr: string; ok: number }[]): ListenLevel {
  const n = rows.length
  const acc = n ? rows.filter((r) => r.ok).length / n : 0
  let best: Cefr | null = null
  for (const c of CEFR) {
    const rs = rows.filter((r) => r.cefr === c)
    if (rs.length >= LISTEN_MIN && rs.filter((r) => r.ok).length / rs.length >= 0.7) best = c
  }
  return { cefr: best, n, acc }
}

export async function listenLevel(): Promise<ListenLevel> {
  // 只看最近 120 题：水平会变
  const rows = await db.all<{ cefr: string; ok: number }>('SELECT cefr, ok FROM listen_log ORDER BY ts DESC LIMIT 120')
  return listenLevelFrom(rows)
}

/** 听力题出多难：最近 10 题对了八成以上就往上提一档，低于五成往下降一档 */
export async function listenTarget(vocabCefr: Cefr): Promise<Cefr> {
  const lv = await listenLevel()
  const recent = await db.all<{ cefr: string; ok: number }>('SELECT cefr, ok FROM listen_log ORDER BY ts DESC LIMIT 10')
  let i = CEFR.indexOf(lv.cefr ?? (CEFR[Math.max(1, CEFR.indexOf(vocabCefr) - 1)] as Cefr))
  if (recent.length >= 6) {
    const acc = recent.filter((r) => r.ok).length / recent.length
    if (acc >= 0.8) i++
    else if (acc < 0.5) i--
  }
  return CEFR[Math.max(1, Math.min(CEFR.length - 1, i))]
}

export async function saveListen(sentenceId: number, hard: number, cefr: string, ok: boolean) {
  await db.batch([
    { sql: 'INSERT INTO listen_log(sentence_id, hard, cefr, ok, ts) VALUES (?,?,?,?,?)', params: [sentenceId, hard, cefr, ok ? 1 : 0, Date.now()] },
    { sql: 'INSERT INTO day(date, listens) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET listens = listens + 1', params: [today()] },
  ])
}

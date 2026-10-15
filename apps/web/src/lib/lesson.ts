// 每日一课：复习（FSRS 到期）+ 新词（从水平边界往后，按目标加权）+ 跟读（今天新词和复习词的例句；有发音弱项时其中一句换成专练弱项的，
// 剧集里没读好的台词到期了也换进来）
import { db, kvGet, kvSet, today } from './db'
import { loadContent, lookup, pickSentence, type Sentence, type Word } from './content'
import { dueWords } from './srs'
import type { Goal, Cefr } from './levels'
import type { Accent } from './tts'
import type { PlacementResult } from './placement'
import { bookOrder } from './books'
import { getInterests, preferTopics, topicMatcher } from './interests'
import { buildCheck, listenLevel, listenTarget, vocabLevel, weeklyDue, type CheckItem } from './calibrate'
import { CEFR } from './levels'
import { weakPhones } from './progress'
import { dueLines, type DueLine } from './episodes'

export type Profile = {
  goal: Goal
  minutes: number
  accent: Accent
  start: Cefr // 定级时的档位（进度从这里算）
  placement: PlacementResult
  /** 词书（ECDICT 考试标签，见 books.ts）；没设 = 按常用程度 */
  book?: string
  createdAt: number
}
export const getProfile = () => kvGet<Profile | null>('profile', null)
export const saveProfile = (p: Profile) => kvSet('profile', p)

// 功能词：太基础、没法做成词卡，学了也是浪费时间，直接当“认识”
export const FUNCTION_WORDS = new Set(`a an the be is am are was were been being have has had do does did i me my mine you your yours he him his she her hers it its we us our ours they them their theirs this that these those
and or but if so as of to in on at by for from with about into over under up down out off than then there here what which who whom whose when where why how not no yes all any some each every
can could will would shall should may might must also very just too only own same such both either neither nor one two three`.split(/\s+/))

export const SIZES: Record<number, { review: number; fresh: number; shadow: number; listen: number }> = {
  10: { review: 20, fresh: 4, shadow: 2, listen: 2 },
  20: { review: 40, fresh: 8, shadow: 3, listen: 4 },
  30: { review: 60, fresh: 12, shadow: 5, listen: 5 },
  45: { review: 90, fresh: 18, shadow: 7, listen: 8 },
}
export const sizeFor = (minutes: number) => SIZES[minutes] ?? SIZES[20]

export type Step =
  | { kind: 'learn'; word: Word; sentence?: Sentence }
  | { kind: 'review'; word: Word; sentence?: Sentence }
  | { kind: 'shadow'; sentence: Sentence; focus?: string; /** 专练这个弱项音素（CMU） */ phone?: string; /** 剧集台词复习（sentence 是拼出来的，id 为负，不进例句库） */ line?: DueLine }
  | { kind: 'listen'; sentence: Sentence; options: string[]; answer: number }
  | { kind: 'check'; items: CheckItem[] }

export type DayRow = { date: string; reviews: number; new_words: number; shadows: number; listens: number; seconds: number; minimum: number; done: number }
export async function dayRow(date = today()): Promise<DayRow> {
  return (await db.one<DayRow>('SELECT * FROM day WHERE date = ?', [date])) ?? { date, reviews: 0, new_words: 0, shadows: 0, listens: 0, seconds: 0, minimum: 0, done: 0 }
}

async function pickNewWords(p: Profile, n: number, words: Word[], frontier: number): Promise<Word[]> {
  const have = new Set((await db.all<{ word: string }>('SELECT word FROM card')).map((r) => r.word))
  const from = Math.max(1, frontier)
  const learnable = words.filter((w) => !have.has(w.w) && !FUNCTION_WORDS.has(w.w) && !w.sensitive && w.cmu.length > 0)
  if (p.book) return bookOrder(learnable, p.book, from).slice(0, n)
  const cand = learnable.filter((w) => w.rank >= from)
  if (p.goal.kind !== 'ielts') return cand.slice(0, n)
  // 雅思目标：在接下来 400 个词的窗口里，带 ielts 标签的优先
  const win = cand.slice(0, 400)
  const tagged = win.filter((w) => w.tags.includes('ielts'))
  const rest = win.filter((w) => !w.tags.includes('ielts'))
  return [...tagged, ...rest, ...cand.slice(400)].slice(0, n)
}

/** 今天每项的量：按短板加权（听力落后词汇一档以上就多排听力） */
export async function dailySize(p: Profile) {
  const base = { ...sizeFor(p.minutes) }
  const [lv, ll] = await Promise.all([vocabLevel(p), listenLevel()])
  if (ll.cefr && CEFR.indexOf(ll.cefr) < CEFR.indexOf(lv.cefr) - 1) base.listen += Math.ceil(base.listen / 2)
  return base
}

/**
 * 专练弱项的跟读句：含这个音的词越多越好（够多时至少两个），只用你水平以内的句子（认识的词才好专心练发音）。
 * 返回句子和要高亮的词（句中第一个含这个音的词）
 */
export function phoneShadow(phone: string, sents: Sentence[], byWord: Map<string, Word>, cap: number, used: Set<number>, rnd = Math.random): { sentence: Sentence; focus?: string } | undefined {
  const hits = (s: Sentence) => s.words.filter((w) => byWord.get(w)?.cmu.includes(phone)).length
  const all = sents.filter((s) => s.hard <= cap && !used.has(s.id) && s.en.length >= 20 && s.en.length <= 70).map((s) => ({ s, n: hits(s) }))
  // 少见的音（/ʒ/ /ɔɪ/）凑不出两个，含一个也行
  const two = all.filter((x) => x.n >= 2)
  const pool = two.length ? two : all.filter((x) => x.n >= 1)
  if (!pool.length) return undefined
  // 不总挑同一句：命中最多的前 20 句里随机
  const top = pool.sort((a, b) => b.n - a.n).slice(0, 20)
  const s = top[Math.floor(rnd() * top.length)].s
  const toks = s.en.match(/[A-Za-z']+/g) ?? []
  const focus = toks.find((t) => lookup(byWord, t)?.cmu.includes(phone))
  return { sentence: s, focus }
}

/** 今天轮到练哪个弱项：前三个弱项按天轮换 */
export const phoneOfDay = (weak: string[], date = today()) => weak.length ? weak[Math.floor(Date.parse(date) / 86400_000) % weak.length] : undefined

/** 听音选义：同档、长度相近的另外两句的译文做干扰项 */
export function listenOptions(s: Sentence, pool: Sentence[], rnd = Math.random): { options: string[]; answer: number } {
  const near = pool.filter((x) => x.id !== s.id && x.cefr === s.cefr && x.zh !== s.zh && Math.abs(x.en.length - s.en.length) <= Math.max(8, s.en.length * 0.4))
  const picks: string[] = []
  while (picks.length < 2 && near.length) {
    const x = near.splice(Math.floor(rnd() * near.length), 1)[0]
    if (!picks.includes(x.zh)) picks.push(x.zh)
  }
  const answer = Math.floor(rnd() * (picks.length + 1))
  const options = [...picks]
  options.splice(answer, 0, s.zh)
  return { options, answer }
}

async function pickListens(n: number, vocabCefr: Cefr, used: Set<number>): Promise<Step[]> {
  if (n <= 0) return []
  const { sents } = await loadContent()
  const target = await listenTarget(vocabCefr)
  const heard = new Set((await db.all<{ sentence_id: number }>('SELECT sentence_id FROM listen_log')).map((r) => r.sentence_id))
  // 太短的句子听不出水平，太长的手机上读选项累
  const pool = sents.filter((s) => s.cefr === target && !heard.has(s.id) && !used.has(s.id) && s.en.length >= 18 && s.en.length <= 80)
  const out: Step[] = []
  const match = topicMatcher(await getInterests())
  while (out.length < n && pool.length) {
    const from = preferTopics(pool, match)
    const s = from[Math.floor(Math.random() * from.length)]
    pool.splice(pool.indexOf(s), 1)
    used.add(s.id)
    out.push({ kind: 'listen', sentence: s, ...listenOptions(s, sents.filter((x) => x.cefr === target)) })
  }
  return out
}

/**
 * 生成今天剩下要做的步骤。
 * minimum = 保底：只复习 5 个词 + 跟读 1 句；comeback = 隔久了回来的 3 分钟：复习 8 个、听 1 句、跟读 1 句，不学新词
 */
export async function buildSession(p: Profile, minimum = false, comeback = false): Promise<Step[]> {
  const { words, byWord, sentsByWord } = await loadContent()
  const size = await dailySize(p)
  const lv = await vocabLevel(p)
  const d = await dayRow()
  if (comeback) minimum = true
  const reviewLeft = comeback ? 8 : minimum ? 5 : Math.max(0, size.review - d.reviews)
  const freshLeft = minimum ? 0 : Math.max(0, size.fresh - d.new_words)
  const shadowLeft = minimum ? 1 : Math.max(0, size.shadow - d.shadows)
  const listenLeft = comeback ? 1 : minimum ? 0 : Math.max(0, size.listen - (d.listens ?? 0))

  const due = (await dueWords(reviewLeft)).map((w) => byWord.get(w)).filter(Boolean) as Word[]
  const fresh = await pickNewWords(p, freshLeft, words, lv.frontier)
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
    const match = topicMatcher(await getInterests())
    for (let i = 0; shadows.length < shadowLeft && pool.length; i++) {
      const from = preferTopics(pool, match)
      const s = from[Math.floor(Math.random() * from.length)]
      pool.splice(pool.indexOf(s), 1)
      shadows.push({ kind: 'shadow', sentence: s })
    }
  }
  // 有发音弱项（某个音练过 5 次以上）时，第一句跟读换成专练它的；总句数不变
  if (!minimum && shadowLeft > 0) {
    const phone = phoneOfDay((await weakPhones(3)).map((w) => w.phone))
    const { sents } = await loadContent()
    const ps = phone && phoneShadow(phone, sents, byWord, Math.max(1500, lv.frontier), used)
    if (ps) {
      used.add(ps.sentence.id)
      if (shadows.length >= shadowLeft) shadows.pop()
      shadows.unshift({ kind: 'shadow', sentence: ps.sentence, focus: ps.focus, phone })
    }
  }
  // 剧集台词到期了：换掉后面的普通句（练得多的计划换两句，否则一句）
  if (!minimum && shadowLeft > 0) {
    const lines = await dueLines(shadowLeft >= 3 ? 2 : 1).catch(() => [] as DueLine[])
    const regular = shadows.filter((x) => x.kind === 'shadow' && !x.phone)
    const head = shadows.filter((x) => x.kind === 'shadow' && x.phone)
    const keep = Math.max(0, shadowLeft - head.length - lines.length)
    shadows.splice(0, shadows.length, ...head, ...lines.map((l, k): Step => ({ kind: 'shadow', sentence: { id: -1 - k, en: l.en, zh: l.zh, hard: 0, cefr: '', words: [] }, line: l })), ...regular.slice(0, keep))
  }
  const listens = await pickListens(listenLeft, lv.cefr, used)
  // 每周小测（1 分钟）放最前面；保底模式不打扰
  const check: Step[] = []
  if (!minimum && (await weeklyDue(p))) {
    const pseudo: string[] = await fetch('./content/pseudo.json').then((r) => r.json()).catch(() => [])
    const have = new Set((await db.all<{ word: string }>('SELECT word FROM card')).map((r) => r.word))
    if (pseudo.length) check.push({ kind: 'check', items: buildCheck(lv.state.bands, words, pseudo, have) })
  }
  // 顺序：小测 → 复习（热身）→ 学新词 → 听力 → 跟读；新词穿插在复习之间会打断节奏，这里不穿插
  return [...check, ...review, ...learn, ...listens, ...shadows]
}

export async function markDay(patch: Partial<Pick<DayRow, 'new_words' | 'shadows' | 'seconds'>> & { minimum?: boolean; done?: boolean }) {
  const d = today()
  await db.run('INSERT INTO day(date) VALUES (?) ON CONFLICT(date) DO NOTHING', [d])
  if (patch.new_words) await db.run('UPDATE day SET new_words = new_words + ? WHERE date = ?', [patch.new_words, d])
  if (patch.shadows) await db.run('UPDATE day SET shadows = shadows + ? WHERE date = ?', [patch.shadows, d])
  if (patch.seconds) await db.run('UPDATE day SET seconds = seconds + ? WHERE date = ?', [Math.round(patch.seconds), d])
  if (patch.minimum) await db.run('UPDATE day SET minimum = 1 WHERE date = ?', [d])
  if (patch.done) await db.run('UPDATE day SET done = 1 WHERE date = ?', [d])
  // 今天练过了：把今天的提醒撤掉（只在 App 里有）
  if (patch.new_words || patch.shadows || patch.done) import('./reminder').then((m) => m.reschedule()).catch(() => {})
  // 练完一组 / 关掉任何练习（复习、听力也算）：刷新桌面小组件
  else import('./widget').then((m) => m.updateWidget()).catch(() => {})
  // 做完一组：把这台设备的新记录传上去（开了同步才会真的传）
  if (patch.done) import('./sync').then((m) => m.autoSync(true)).catch(() => {})
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

/** 录音存档（进步页“前后对比”）：每句只留第一次和最近一次；总数超过 200 条删最旧的“最近一次” */
export async function saveRecording(sentenceId: number | null, text: string, score: number, audio: Float32Array) {
  const pcm = new Int16Array(audio.length)
  for (let i = 0; i < audio.length; i++) pcm[i] = Math.max(-1, Math.min(1, audio[i])) * 32767
  const bytes = new Uint8Array(pcm.buffer)
  const rows = await db.all<{ id: number }>('SELECT id FROM recording WHERE text = ? ORDER BY ts', [text])
  const items: { sql: string; params?: unknown[] }[] = []
  // 已有“第一次”就把旧的“最近一次”换掉
  if (rows.length >= 2) for (const r of rows.slice(1)) items.push({ sql: 'DELETE FROM recording WHERE id = ?', params: [r.id] })
  items.push({ sql: 'INSERT INTO recording(sentence_id, text, score, pcm, ts) VALUES (?,?,?,?,?)', params: [sentenceId, text, score, bytes, Date.now()] })
  items.push({ sql: `DELETE FROM recording WHERE id IN (SELECT id FROM recording r WHERE ts > (SELECT min(ts) FROM recording x WHERE x.text = r.text) ORDER BY ts LIMIT max(0, (SELECT count(*) FROM recording) - 200))` })
  await db.batch(items)
}

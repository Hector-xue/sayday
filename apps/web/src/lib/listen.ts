// 听学（被动学习）：像听歌一样戴着耳机听，老师一个词一个词地讲：
//   读单词 → 逐个字母拼 → 再读一遍 → 中文讲意思 → 读例句 → 例句的中文 → 例句再读一遍
// 这里只负责“讲什么”：挑词、把词典释义整理成能念的中文、排出每个词的讲解脚本（Track）。
// 怎么播放见 listen-player.ts（安卓走原生前台播放服务，锁屏、切到后台都不停；网页 / 电脑版在页面里播）。
// 被动听不改复习进度（没有回忆就不算复习），只记“听过”（passive_log），给听学页和进步统计用。
import { db, kvGet, kvSet, today } from './db'
import { loadContent, pickSentence, type Sentence, type Word } from './content'
import { dueWords } from './srs'
import { listenCourse, previewWords, type Profile } from './lesson'
import { glossParts, glossShort, glossSpeech, zhKey } from './gloss'

/**
 * 一段讲解：预生成的音频（单词 w / 拼读 p / 例句 s / 中文 z：释义和例句译文）、系统语音现念、停顿。
 * 中文也是 CI 提前合成好的（音频包 zh/<zhKey(念的字)>.mp3，不分口音）：手机自带的中文语音大多机械、有杂音
 */
export type Seg =
  | { t: 'audio'; kind: 'w' | 's' | 'p' | 'z'; key: string; /** 没有这段音频时改用系统语音念的内容 */ text: string }
  | { t: 'say'; lang: 'zh' | 'en'; text: string }
  | { t: 'gap'; ms: number }

/** 一个词的完整讲解 */
export type Track = { word: string; ipa: string; gloss: string; sentence?: { id: number; en: string; zh: string }; segs: Seg[] }

export type Source = 'course' | 'today' | 'weak' | 'recent' | 'preview'
export const SOURCES: { k: Source; name: string; desc: string }[] = [
  { k: 'course', name: '纯听学', desc: '按词表一组组往下听，单独记进度' },
  { k: 'today', name: '今天的词', desc: '今天学的新词和到期要复习的' },
  { k: 'weak', name: '快忘的词', desc: '常记错、快到复习时间的' },
  { k: 'recent', name: '最近学的', desc: '按学的时间从近到远' },
  { k: 'preview', name: '预习新词', desc: '接下来要学的，先混个耳熟' },
]

export type ListenPrefs = {
  src: Source
  /** 一轮听多少个词 */
  n: number
  spell: boolean
  zh: boolean
  example: boolean
  /** 听完一轮从头再来 */
  loop: boolean
  /** 纯听学用哪本词书：'' 跟每日练习一样，'freq' 按常用程度，其余是词书标签（books.ts） */
  book: string
}
export const COUNTS = [10, 20, 40] as const
export const DEFAULT_PREFS: ListenPrefs = { src: 'course', n: 20, spell: true, zh: true, example: true, loop: true, book: '' }

export async function getPrefs(): Promise<ListenPrefs> {
  const p = await kvGet<Partial<ListenPrefs> | null>('listen', null)
  const out = { ...DEFAULT_PREFS, ...(p ?? {}) }
  if (!SOURCES.some((s) => s.k === out.src)) out.src = DEFAULT_PREFS.src
  if (!COUNTS.includes(out.n as never)) out.n = DEFAULT_PREFS.n
  if (typeof out.book !== 'string') out.book = ''
  return out
}
export const savePrefs = (p: ListenPrefs) => kvSet('listen', p)

// 释义整理（词典写法 → 能念出来的中文）在 gloss.ts：音频包的 CI 合成也要用同一份代码算出要念的中文
export { glossParts, glossShort, glossSpeech, zhKey, type GlossPart } from './gloss'

// ---------------- 讲解脚本 ----------------

export type ScriptOpts = Pick<ListenPrefs, 'spell' | 'zh' | 'example'>

/**
 * 拼读：整个词的字母一段音频（音频包 p/，CI 合成，见 content/audio/build_audio.mjs），不是一个个字母拼起来——
 * 单个字母单独合成又慢又容易念错（前面多出含糊的音），整串合成一个字母约 0.25 秒、念得清楚。
 * text 是音频包里没有这个词时（自己收的词、没联网）系统语音念的：字母逗号隔开，连字符念 hyphen，空格停一下，撇号不念
 */
export function spellText(word: string): string {
  const out: string[] = []
  for (const c of word.toLowerCase()) {
    if (/[a-z]/.test(c)) out.push(c.toUpperCase())
    else if (c === '-') out.push('hyphen')
    else if (c === ' ' && out.length) out[out.length - 1] += '.'
  }
  return out.map((x, i) => (i === out.length - 1 || x.endsWith('.') ? x : x + ',')).join(' ')
}
export const spellSeg = (word: string): Seg => ({ t: 'audio', kind: 'p', key: word, text: spellText(word) })

/** 能拼读的词：至少两个字母（单个字母的词拼了等于没拼），最长 20 个字符 */
export const canSpellAloud = (w: string) => /^[a-z][a-z' -]*[a-z]$/i.test(w) && w.length <= 20

/** 一段中文（释义 / 例句译文）：音频包里按念的字找 */
export const zhSeg = (text: string): Seg => ({ t: 'audio', kind: 'z', key: zhKey(text), text })

export function buildTrack(word: Word, sentence: Sentence | undefined, o: ScriptOpts): Track {
  const parts = glossParts(word.zh)
  const gloss = glossShort(parts)
  const say = glossSpeech(parts)
  const w: Seg = { t: 'audio', kind: 'w', key: word.w, text: word.w }
  const segs: Seg[] = [w]
  if (o.spell && canSpellAloud(word.w)) segs.push({ t: 'gap', ms: 500 }, spellSeg(word.w), { t: 'gap', ms: 500 }, w)
  if (o.zh && say) segs.push({ t: 'gap', ms: 600 }, zhSeg(say))
  if (o.example && sentence) {
    const s: Seg = { t: 'audio', kind: 's', key: String(sentence.id), text: sentence.en }
    segs.push({ t: 'gap', ms: 800 }, s)
    if (o.zh && sentence.zh) segs.push({ t: 'gap', ms: 450 }, zhSeg(sentence.zh), { t: 'gap', ms: 450 }, s)
    else segs.push({ t: 'gap', ms: 900 }, s)
  }
  // 词和词之间留一口气
  segs.push({ t: 'gap', ms: 1500 })
  return { word: word.w, ipa: word.ipa, gloss, sentence: sentence && { id: sentence.id, en: sentence.en, zh: sentence.zh }, segs }
}

/** 粗估一个词讲多久（秒），给“这一轮约 N 分钟”用：英文单词 0.8 秒、拼读每个字母 0.3 秒、中文每字 0.22 秒、英文句子每字符 0.07 秒 */
export function estimateSec(t: Track): number {
  let ms = 0
  for (const s of t.segs) {
    if (s.t === 'gap') ms += s.ms
    else if (s.t === 'say') ms += s.lang === 'zh' ? s.text.length * 220 : 600
    else if (s.kind === 'z') ms += s.text.length * 220
    else if (s.kind === 'p') ms += 300 + s.key.replace(/[^a-z]/gi, '').length * 300
    else if (s.kind === 'w') ms += 800
    else ms += Math.max(1200, s.text.length * 70)
  }
  return ms / 1000
}

// ---------------- 挑词 ----------------

/** 换日按凌晨 4 点（和 db.today 一致）：今天开始的时间戳 */
export function dayStart(now = new Date()): number {
  const [y, m, d] = today(now).split('-').map(Number)
  return new Date(y, m - 1, d, 4).getTime()
}

// ---------------- 纯听学的进度 ----------------

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

/**
 * 纯听学排下一组：前几天听过、还没听熟的先复习（最多占一半，最久没听的在前；今天听过的不算，免得一直是那几个），
 * 其余按词表顺序补没听过的新词；新词没了再多排些在听的。exclude：“换一组”时把这一组的词去掉
 */
export function pickCourse(order: string[], stats: Map<string, HeardStat>, n: number, since: number, exclude: Set<string> = new Set()): string[] {
  const ok = order.filter((w) => !exclude.has(w))
  const learning = ok.filter((w) => { const s = stats.get(w); return !!s && s.days < MASTER_DAYS })
  const due = learning.filter((w) => stats.get(w)!.last < since).sort((a, b) => stats.get(a)!.last - stats.get(b)!.last)
  const review = due.slice(0, Math.floor(n / 2))
  const out = [...review, ...ok.filter((w) => !stats.has(w)).slice(0, n - review.length)]
  if (out.length < n) {
    const has = new Set(out)
    out.push(...[...due, ...learning].filter((w) => !has.has(w) && has.add(w)).slice(0, n - out.length))
  }
  return out
}

export type CourseProgress = { total: number; done: number; learning: number }
export function courseProgress(order: string[], stats: Map<string, HeardStat>): CourseProgress {
  let done = 0, learning = 0
  for (const w of order) {
    const s = stats.get(w)
    if (s) s.days >= MASTER_DAYS ? done++ : learning++
  }
  return { total: order.length, done, learning }
}

/** 纯听学的进度：词表多少个词、听熟了几个、在听几个 */
export async function courseStatus(profile: Profile, book = ''): Promise<CourseProgress> {
  const [course, stats] = await Promise.all([listenCourse(profile, book), heardStats()])
  return courseProgress(course.map((w) => w.w), stats)
}

/**
 * 按来源挑词（已去掉词库里查不到的）。“今天的词”没有时退到“最近学的”，返回实际用的来源。
 * exclude：“换一组”时去掉正在听的这一组，换成别的词
 */
export async function pickWords(src: Source, n: number, profile: Profile, rnd = Math.random, exclude: Set<string> = new Set(), book = ''): Promise<{ words: Word[]; src: Source }> {
  const { byWord } = await loadContent()
  const keep = (ws: string[]) => [...new Set(ws)].filter((w) => !exclude.has(w)).map((w) => byWord.get(w)).filter((w): w is Word => !!w)
  const more = n + exclude.size
  if (src === 'course') {
    const course = await listenCourse(profile, book)
    return { words: keep(pickCourse(course.map((w) => w.w), await heardStats(), n, dayStart(), exclude)), src }
  }
  if (src === 'today') {
    const fresh = (await db.all<{ word: string }>('SELECT word FROM card WHERE known = 0 AND added >= ? ORDER BY added', [dayStart()])).map((r) => r.word)
    const due = await dueWords(more)
    const ws = keep([...fresh, ...due]).slice(0, n)
    if (ws.length) return { words: ws, src }
    return pickWords('recent', n, profile, rnd, exclude)
  }
  if (src === 'weak') {
    // 记错过的在前（错得多的更前），再按复习时间从近到远；学习中（还没稳定）的也算
    const rows = await db.all<{ word: string }>('SELECT word FROM card WHERE known = 0 ORDER BY (lapses > 0) DESC, lapses DESC, due ASC LIMIT ?', [n * 2 + exclude.size])
    // 取前 2n 个打乱再截 n 个：每次听的不完全一样，又都是最该听的
    const ws = keep(rows.map((r) => r.word))
    for (let i = ws.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ws[i], ws[j]] = [ws[j], ws[i]] }
    return { words: ws.slice(0, n), src }
  }
  if (src === 'recent') {
    const rows = await db.all<{ word: string }>('SELECT word FROM card WHERE known = 0 ORDER BY added DESC LIMIT ?', [more])
    return { words: keep(rows.map((r) => r.word)).slice(0, n), src }
  }
  return { words: keep((await previewWords(profile, more)).map((w) => w.w)).slice(0, n), src }
}

/** 挑词 + 给每个词配一句例句（同一轮里例句不重复）+ 排出讲解脚本 */
export async function buildPlaylist(prefs: ListenPrefs, profile: Profile, exclude?: Set<string>): Promise<{ tracks: Track[]; src: Source }> {
  const { sentsByWord } = await loadContent()
  const { words, src } = await pickWords(prefs.src, prefs.n, profile, Math.random, exclude, prefs.book)
  const used = new Set<number>()
  const tracks = words.map((w) => {
    const s = prefs.example ? pickSentence(sentsByWord.get(w.w), w.rank, used) : undefined
    if (s) used.add(s.id)
    return buildTrack(w, s, prefs)
  })
  return { tracks, src }
}

// ---------------- 听过的记录 ----------------

export type Heard = { w: string; ts: number; sec: number }

/** 记下听完的词（同一个词同一毫秒只记一次：原生那边重复交过来也不会重复记） */
export async function logHeard(items: Heard[]) {
  const ok = items.filter((x) => x && typeof x.w === 'string' && x.w && Number.isFinite(x.ts) && Number.isFinite(x.sec) && x.sec >= 0)
  if (!ok.length) return
  await db.batch(ok.map((x) => ({
    sql: 'INSERT INTO passive_log(word, ts, sec) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM passive_log WHERE word = ? AND ts = ?)',
    params: [x.w, Math.round(x.ts), Math.round(x.sec * 10) / 10, x.w, Math.round(x.ts)],
  })))
}

/** 今天听了多久（秒）、听了几个词（不同的） */
export async function todayHeard(): Promise<{ sec: number; words: number }> {
  const r = await db.one<{ sec: number | null; words: number }>('SELECT sum(sec) sec, count(DISTINCT word) words FROM passive_log WHERE ts >= ?', [dayStart()])
  return { sec: r?.sec ?? 0, words: r?.words ?? 0 }
}

/** 每个词一共听过几遍 */
export async function heardCounts(words: string[]): Promise<Map<string, number>> {
  if (!words.length) return new Map()
  const rows = await db.all<{ word: string; n: number }>(`SELECT word, count(*) n FROM passive_log WHERE word IN (${words.map(() => '?').join(',')}) GROUP BY word`, words)
  return new Map(rows.map((r) => [r.word, r.n]))
}

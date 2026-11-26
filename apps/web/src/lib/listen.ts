// 听学（被动学习）：像听歌一样戴着耳机听，老师一个词一个词地讲：
//   读单词 → 逐个字母拼 → 再读一遍 → 中文讲意思 → 读例句 → 例句的中文 → 例句再读一遍
// 这里只负责“讲什么”：挑词、把词典释义整理成能念的中文、排出每个词的讲解脚本（Track）。
// 怎么播放见 listen-player.ts（安卓走原生前台播放服务，锁屏、切到后台都不停；网页 / 电脑版在页面里播）。
// 被动听不改复习进度（没有回忆就不算复习），只记“听过”（passive_log），给听学页和进步统计用。
import { db, kvGet, kvSet, today } from './db'
import { loadContent, pickSentence, type Sentence, type Word } from './content'
import { dueWords } from './srs'
import { previewWords, type Profile } from './lesson'

/** 一段讲解：预生成的音频（单词 / 例句 / 字母）、系统语音现念（中文释义、例句译文）、停顿 */
export type Seg =
  | { t: 'audio'; kind: 'w' | 's' | 'l'; key: string; /** 没有这段音频时改用系统语音念的内容 */ text: string }
  | { t: 'say'; lang: 'zh' | 'en'; text: string }
  | { t: 'gap'; ms: number }

/** 一个词的完整讲解 */
export type Track = { word: string; ipa: string; gloss: string; sentence?: { id: number; en: string; zh: string }; segs: Seg[] }

export type Source = 'today' | 'weak' | 'recent' | 'preview'
export const SOURCES: { k: Source; name: string; desc: string }[] = [
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
}
export const COUNTS = [10, 20, 40] as const
export const DEFAULT_PREFS: ListenPrefs = { src: 'today', n: 20, spell: true, zh: true, example: true, loop: true }

export async function getPrefs(): Promise<ListenPrefs> {
  const p = await kvGet<Partial<ListenPrefs> | null>('listen', null)
  const out = { ...DEFAULT_PREFS, ...(p ?? {}) }
  if (!SOURCES.some((s) => s.k === out.src)) out.src = DEFAULT_PREFS.src
  if (!COUNTS.includes(out.n as never)) out.n = DEFAULT_PREFS.n
  return out
}
export const savePrefs = (p: ListenPrefs) => kvSet('listen', p)

// ---------------- 释义：词典写法 → 能念出来的中文 ----------------

// ECDICT 的词性缩写（a. = 形容词）。及物 / 不及物都念“动词”：听的时候分得太细反而记不住
const POS: Record<string, string> = {
  n: '名词', a: '形容词', adj: '形容词', v: '动词', vt: '动词', vi: '动词', adv: '副词', pron: '代词', prep: '介词', conj: '连词',
  num: '数词', int: '感叹词', interj: '感叹词', art: '冠词', aux: '助动词', abbr: '缩写', pl: '复数', vbl: '动词',
}

export type GlossPart = { pos: string; senses: string[] }

/**
 * 词典释义整理成“词性 + 前几个意思”：去掉 [计] <法> (芭蕾舞用语) 这类标注，同一个词性（vt. / vi.）合并，
 * 最多 maxPos 个词性、每个最多 maxSense 个意思，意思加起来不超过 maxChars 个字（听的时候太长记不住）
 */
export function glossParts(zh: string, maxPos = 2, maxSense = 3, maxChars = 24): GlossPart[] {
  const clean = zh
    .replace(/\\[rn]|[\r\n]/g, '；')
    // 书名号的旧写法 <<启示录>>：留下书名（只去括号）
    .replace(/<<([^<>]*)>>|《([^》]*)》/g, (_, a, b) => a ?? b)
    .replace(/\[[^\]]*\]|<[^>]*>|\([^)]*\)|（[^）]*）|【[^】]*】/g, '')
    .replace(/[<>[\]()（）【】]/g, '')
    // 逗号后面紧跟词性的（“细读, vi. 细看”）也是另起一组
    .replace(new RegExp(`[,，]\\s*(?=(?:${Object.keys(POS).join('|')})\\.)`, 'gi'), '；')
  const parts: GlossPart[] = []
  let chars = 0
  // 分号后面没写词性的（“vt. 剽窃；偷偷地做；vi. 窃取”里的“偷偷地做”）接着算前一个词性
  let last = ''
  for (const group of clean.split(/[；;]/)) {
    // 开头的词性可能连着写好几个（“vt.vi.”“n.&a.”）：都吃掉，用第一个认识的
    let body = group
    let pos = ''
    let tagged = false
    for (;;) {
      const m = body.match(/^\s*([a-z]+)\.\s*(?:[&/和]\s*)?/i)
      if (!m || !Object.hasOwn(POS, m[1].toLowerCase())) break
      pos ||= POS[m[1].toLowerCase()]
      tagged = true
      body = body.slice(m[0].length)
    }
    if (!tagged) pos = last
    last = pos
    const senses = body.split(/[,，、/]/).map((s) => s.trim()).filter((s) => s && /[\u4e00-\u9fff]/.test(s))
    if (!senses.length) continue
    let part = parts.find((p) => p.pos === pos)
    if (!part) {
      if (parts.length >= maxPos) continue
      part = { pos, senses: [] }
      parts.push(part)
    }
    for (const s of senses) {
      if (part.senses.length >= maxSense || part.senses.includes(s)) continue
      // 第一个意思总要留；后面的超过字数就不要了
      if (chars > 0 && chars + s.length > maxChars) break
      part.senses.push(s)
      chars += s.length
    }
  }
  return parts.filter((p) => p.senses.length)
}

/** 念给你听的：“名词，市场。形容词，不同的，变化多的。” */
// 词典里的“测定...的时间”：省略号念出来不像话，换成“某事”
export const glossSpeech = (parts: GlossPart[]) => parts.map((p) => (p.pos ? `${p.pos}，` : '') + p.senses.join('，').replace(/\.{2,}|…+/g, '某事') + '。').join('')
/** 屏幕和锁屏上显示的：“n. 市场；a. 不同的，变化多的” 太长，只要意思 */
export const glossShort = (parts: GlossPart[]) => parts.map((p) => p.senses.join('，')).join('；')

// ---------------- 讲解脚本 ----------------

export type ScriptOpts = Pick<ListenPrefs, 'spell' | 'zh' | 'example'>

/** 拼读：字母之间短停，长词每 4 个字母多停一下（像老师念电话号码）；连字符念 hyphen，撇号不念 */
export function spellSegs(word: string): Seg[] {
  const out: Seg[] = []
  const chars = [...word.toLowerCase()]
  let run = 0
  for (const c of chars) {
    if (/[a-z]/.test(c)) {
      if (out.length) out.push({ t: 'gap', ms: run > 0 && run % 4 === 0 && chars.length > 6 ? 380 : 150 })
      out.push({ t: 'audio', kind: 'l', key: c, text: c.toUpperCase() })
      run++
    } else if (c === '-') {
      out.push({ t: 'gap', ms: 250 }, { t: 'say', lang: 'en', text: 'hyphen' })
      run = 0
    } else if (c === ' ') {
      out.push({ t: 'gap', ms: 450 })
      run = 0
    }
    // 撇号等符号：不念
  }
  return out
}

/** 能拼读的词：至少两个字母（单个字母的词拼了等于没拼），最长 20 个字符 */
export const canSpellAloud = (w: string) => /^[a-z][a-z' -]*[a-z]$/i.test(w) && w.length <= 20

export function buildTrack(word: Word, sentence: Sentence | undefined, o: ScriptOpts): Track {
  const parts = glossParts(word.zh)
  const gloss = glossShort(parts)
  const say = glossSpeech(parts)
  const w: Seg = { t: 'audio', kind: 'w', key: word.w, text: word.w }
  const segs: Seg[] = [w]
  if (o.spell && canSpellAloud(word.w)) segs.push({ t: 'gap', ms: 500 }, ...spellSegs(word.w), { t: 'gap', ms: 500 }, w)
  if (o.zh && say) segs.push({ t: 'gap', ms: 600 }, { t: 'say', lang: 'zh', text: say })
  if (o.example && sentence) {
    const s: Seg = { t: 'audio', kind: 's', key: String(sentence.id), text: sentence.en }
    segs.push({ t: 'gap', ms: 800 }, s)
    if (o.zh && sentence.zh) segs.push({ t: 'gap', ms: 450 }, { t: 'say', lang: 'zh', text: sentence.zh }, { t: 'gap', ms: 450 }, s)
    else segs.push({ t: 'gap', ms: 900 }, s)
  }
  // 词和词之间留一口气
  segs.push({ t: 'gap', ms: 1500 })
  return { word: word.w, ipa: word.ipa, gloss, sentence: sentence && { id: sentence.id, en: sentence.en, zh: sentence.zh }, segs }
}

/** 粗估一个词讲多久（秒），给“这一轮约 N 分钟”用：英文单词 0.8 秒、字母 0.45 秒、中文每字 0.22 秒、英文句子每字符 0.07 秒 */
export function estimateSec(t: Track): number {
  let ms = 0
  for (const s of t.segs) {
    if (s.t === 'gap') ms += s.ms
    else if (s.t === 'say') ms += s.lang === 'zh' ? s.text.length * 220 : 600
    else if (s.kind === 'l') ms += 450
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

/** 按来源挑词（已去掉词库里查不到的）。“今天的词”没有时退到“最近学的”，返回实际用的来源 */
export async function pickWords(src: Source, n: number, profile: Profile, rnd = Math.random): Promise<{ words: Word[]; src: Source }> {
  const { byWord } = await loadContent()
  const keep = (ws: string[]) => [...new Set(ws)].map((w) => byWord.get(w)).filter((w): w is Word => !!w)
  if (src === 'today') {
    const fresh = (await db.all<{ word: string }>('SELECT word FROM card WHERE known = 0 AND added >= ? ORDER BY added', [dayStart()])).map((r) => r.word)
    const due = await dueWords(n)
    const ws = keep([...fresh, ...due]).slice(0, n)
    if (ws.length) return { words: ws, src }
    return pickWords('recent', n, profile, rnd)
  }
  if (src === 'weak') {
    // 记错过的在前（错得多的更前），再按复习时间从近到远；学习中（还没稳定）的也算
    const rows = await db.all<{ word: string }>('SELECT word FROM card WHERE known = 0 ORDER BY (lapses > 0) DESC, lapses DESC, due ASC LIMIT ?', [n * 2])
    // 取前 2n 个打乱再截 n 个：每次听的不完全一样，又都是最该听的
    const ws = keep(rows.map((r) => r.word))
    for (let i = ws.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ws[i], ws[j]] = [ws[j], ws[i]] }
    return { words: ws.slice(0, n), src }
  }
  if (src === 'recent') {
    const rows = await db.all<{ word: string }>('SELECT word FROM card WHERE known = 0 ORDER BY added DESC LIMIT ?', [n])
    return { words: keep(rows.map((r) => r.word)), src }
  }
  return { words: await previewWords(profile, n), src }
}

/** 挑词 + 给每个词配一句例句（同一轮里例句不重复）+ 排出讲解脚本 */
export async function buildPlaylist(prefs: ListenPrefs, profile: Profile): Promise<{ tracks: Track[]; src: Source }> {
  const { sentsByWord } = await loadContent()
  const { words, src } = await pickWords(prefs.src, prefs.n, profile)
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

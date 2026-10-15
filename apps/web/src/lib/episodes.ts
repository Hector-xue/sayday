// 剧集（方案 1.2）：一天解锁一集，制造“明天还想打开”。第一季 Life in London，第二季 Edinburgh……
// 每集：听（逐句播放，角色各自的声音）→ 演（你演林，逐句跟读打分）→ 测（3 道听力理解题）→ 收生词
import { kvGet, kvSet, today } from './db'
import { loadContent, lookup, type Word } from './content'
import NAMES from '../../../../content/episodes/names.json'

/**
 * named：这句原文里提到了主角的名字（换名字时要换配音）。
 * key：配音键的后半段（s<季>e<集>-<key>）；主线是行号，分支是 c<选项>-<行>，支线是 b-<行>（见 epLines）。
 * mi：主线的行号（分支、支线的台词没有；台词复习只排主线）
 */
export type Line = { who: string; en: string; zh: string; named?: boolean; key?: string; mi?: number }
/** 剧情分支（方案 1.2）：主线第 at 行之后由你选怎么回，选项的第一句是你说的，后面是对方的反应，然后接回主线 */
export type Choice = { at: number; q_zh: string; options: { label_zh: string; lines: Line[] }[] }
/** 隐藏支线：演的时候跟读平均到 need 分（默认 85）才解锁 */
export type Bonus = { title_zh: string; need?: number; lines: Line[] }
export type Episode = { id: number; level: string; title: string; title_zh: string; scene_zh: string; lines: Line[]; choice?: Choice; bonus?: Bonus; quiz: { q: string; options: string[]; answer: number }[]; next_zh: string }
export type Season = { season: number; title: string; title_zh: string; cast: Record<string, { zh: string; voice: string | Record<string, string>; me?: boolean }>; episodes: Episode[] }
/** pick：上次选的分支；bonus：解锁过隐藏支线 */
type Done = { date: string; quiz: number; act: number | null; pick?: number; bonus?: boolean }
export const BONUS_NEED = 85

/** 这一集实际要放的台词：主线 + 选中的分支（还没选就只到分岔处为止的主线 + 之后的主线，分支空着） */
export function epLines(ep: Episode, pick: number | null): Line[] {
  const main = ep.lines.map((l, i) => ({ ...l, key: String(i), mi: i }))
  const c = ep.choice
  if (!c || pick === null || !c.options[pick]) return main
  const branch = c.options[pick].lines.map((l, j) => ({ ...l, key: `c${pick}-${j}` }))
  return [...main.slice(0, c.at + 1), ...branch, ...main.slice(c.at + 1)]
}
export const bonusLines = (ep: Episode): Line[] => (ep.bonus?.lines ?? []).map((l, j) => ({ ...l, key: `b-${j}` }))
/** done 的键是 "季:集"（v0.0.4 第一版只有第一季，键是集号，读的时候换算） */
export type EpProgress = { done: Record<string, Done> }

export const SEASONS = [1, 2, 3, 4]

// ---- 剧里的“你”：默认叫 Lin（林）、女声；可以换成预先配好音的英文名、换男声，也可以自己填名字 ----
export type Me = { name: string; voice: 'f' | 'm' }
export const DEFAULT_ME: Me = { name: 'Lin', voice: 'f' }
/** 预先配好音的名字（content/episodes/names.json，和配音脚本共用） */
export const PRESET_NAMES: string[] = NAMES.names
/** 名字只收英文字母（可带空格、连字符、撇号），首字母大写；不合法返回 null */
export function cleanName(s: string): string | null {
  const t = s.trim().replace(/\s+/g, ' ')
  if (!/^[A-Za-z][A-Za-z' -]{0,15}$/.test(t)) return null
  return t[0].toUpperCase() + t.slice(1)
}
export async function getMe(): Promise<Me> {
  const m = await kvGet<Me>('me', DEFAULT_ME)
  return { name: cleanName(m?.name ?? '') ?? 'Lin', voice: m?.voice === 'm' ? 'm' : 'f' }
}
export async function setMe(m: Me) { await kvSet('me', m); cache = null }
/** 中文界面里怎么称呼你：默认还叫“林”，改了名就直接用英文名 */
export const meZh = (m: Me) => (m.name === 'Lin' ? '林' : m.name)
/** 名字是不是预先配好音的（列表外的名字，提到名字的那几句改用系统朗读） */
export const presetOf = (name: string) => PRESET_NAMES.find((n) => n.toLowerCase() === name.toLowerCase()) ?? null

const NAME_EN = /\bLin\b/g
const NAME_ZH = /(?<!柏)林/g // “都柏林”不是人名
/** 把一季里所有文字中的 Lin / 林 换成你的名字；who、voice 这些内部字段不动 */
export function personalize(s: Season, me: Me): Season {
  const zh = meZh(me)
  const walk = (v: unknown, k = ''): unknown => {
    if (typeof v === 'string') return k === 'who' || k === 'voice' || me.name === 'Lin' ? v : v.replace(NAME_EN, me.name).replace(NAME_ZH, zh)
    if (Array.isArray(v)) return v.map((x) => walk(x, k))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, walk(x, kk)]))
    return v
  }
  const out = walk(s) as Season
  const mark = (to: Line[] | undefined, from: Line[] | undefined) => to?.forEach((l, i) => { l.named = /\bLin\b/.test(from![i].en) })
  out.episodes.forEach((ep, e) => {
    const o = s.episodes[e]
    mark(ep.lines, o.lines)
    ep.choice?.options.forEach((op, k) => mark(op.lines, o.choice!.options[k].lines))
    mark(ep.bonus?.lines, o.bonus?.lines)
  })
  return out
}
export const meKey = (s: Season) => Object.entries(s.cast).find(([, c]) => c.me)?.[0] ?? 'Lin'

let cache: Promise<Season[]> | null = null
let raw: Promise<Season[]> | null = null
export const loadSeasons = (): Promise<Season[]> => (cache ??= (async () => {
  raw ??= Promise.all(SEASONS.map((n) => fetch(`./content/episodes-s${n}.json`).then((r) => r.json())))
  const [all, me] = await Promise.all([raw, getMe()])
  return all.map((s) => personalize(s, me))
})())
/** 兼容旧调用：第一季 */
export const loadSeason = async (): Promise<Season> => (await loadSeasons())[0]

export const key = (season: number, ep: number) => `${season}:${ep}`

export async function getProgress(): Promise<EpProgress> {
  const p = await kvGet<EpProgress>('ep_progress', { done: {} })
  const done: Record<string, Done> = {}
  for (const [k, v] of Object.entries(p.done)) done[k.includes(':') ? k : key(1, Number(k))] = v
  return { done }
}

/** 这一集之前的那一集（跨季：第二季第 1 集的前一集是第一季最后一集） */
function prevOf(all: Season[], season: number, ep: number): [number, number] | null {
  if (ep > 1) return [season, ep - 1]
  const i = all.findIndex((s) => s.season === season)
  if (i <= 0) return null
  const ps = all[i - 1]
  return [ps.season, ps.episodes[ps.episodes.length - 1].id]
}

/** 第一季第一集随时能看；之后每集要等上一集看完的第二天（按凌晨 4 点换日） */
export function unlocked(all: Season[], season: number, ep: number, p: EpProgress, now = today()): boolean {
  const prev = prevOf(all, season, ep)
  if (!prev) return true
  const d = p.done[key(...prev)]
  return !!d && d.date < now
}

export function nextUp(all: Season[], p: EpProgress): { season: Season; ep: Episode; state: 'ready' | 'tomorrow' | 'all-done' } {
  for (const s of all) {
    const first = s.episodes.find((e) => !p.done[key(s.season, e.id)])
    if (first) return { season: s, ep: first, state: unlocked(all, s.season, first.id, p) ? 'ready' : 'tomorrow' }
  }
  const last = all[all.length - 1]
  return { season: last, ep: last.episodes[last.episodes.length - 1], state: 'all-done' }
}

/** 下一集的预告：上一集结尾的 next_zh */
export function teaserFor(all: Season[], season: number, ep: number): string {
  const prev = prevOf(all, season, ep)
  if (!prev) return ''
  return all.find((s) => s.season === prev[0])?.episodes.find((e) => e.id === prev[1])?.next_zh ?? ''
}

export async function finish(season: number, ep: number, quiz: number, act: number | null, extra: { pick?: number | null; bonus?: boolean } = {}) {
  const p = await getProgress()
  const k = key(season, ep)
  const old = p.done[k]
  p.done[k] = { date: old?.date ?? today(), quiz: Math.max(quiz, old?.quiz ?? 0), act: act ?? old?.act ?? null, pick: extra.pick ?? old?.pick, bonus: !!(extra.bonus || old?.bonus) }
  await kvSet('ep_progress', p)
}

/**
 * 这句台词用哪条配音：<键>（默认）、<键>.m（你的台词换男声）、<键>[.m].n-<名字>（提到你名字的句子）。
 * 名字不在预配列表里：提到名字的句子不给配音键，播放时走系统朗读（总比念错名字好）
 */
export function clipOf(season: number, ep: number, i: number, l: Line, me: Me, mine: boolean): { text: string; ep?: string } {
  const base = `s${season}e${ep}-${l.key ?? i}`
  const m = mine && me.voice === 'm' ? '.m' : ''
  if (l.named && me.name !== 'Lin') {
    const p = presetOf(me.name)
    return p ? { text: l.en, ep: `${base}${m}.n-${p.toLowerCase()}` } : { text: l.en }
  }
  return { text: l.en, ep: base + m }
}

/** 这一集里值得学的词：词表里有、不太基础、还没进词卡的（按难度从易到难，最多 6 个） */
export async function episodeWords(ep: Episode, have: Set<string>, frontier: number, myName = 'Lin'): Promise<Word[]> {
  const { byWord } = await loadContent()
  const seen = new Set<string>()
  const out: Word[] = []
  for (const l of ep.lines) for (const t of l.en.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []) {
    if (t.toLowerCase() === myName.toLowerCase()) continue // 你的名字（Grace、Max 这类本身也是单词）
    const w = lookup(byWord, t)
    if (!w || seen.has(w.w) || have.has(w.w) || w.sensitive || w.rank < Math.max(600, frontier * 0.6)) continue
    seen.add(w.w)
    out.push(w)
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, 6)
}

// ---- 台词复习：演的时候没读好（< 80 分）或跳过的台词，排进之后几天的每日跟读 ----
// 只存位置（季/集/行），播放和文字在用的时候再按当前名字、声音取；读到 80 分往后推（1→3→7→14 天），读好四轮就不再出现
export type LineCard = { s: number; e: number; i: number; box: number; due: string }
export const LINE_PASS = 80
const LINE_GAPS = [1, 3, 7, 14]
const LINE_MAX = 60
const addDays = (date: string, n: number) => today(new Date(Date.parse(date + 'T12:00:00') + n * 86400_000))
const same = (a: LineCard, b: { s: number; e: number; i: number }) => a.s === b.s && a.e === b.e && a.i === b.i

/** 演完一集：没读好的台词进队列（已在队里的重新从头排），队列最多 60 句，满了丢最早的 */
export function enqueueLines(list: LineCard[], season: number, ep: number, mine: number[], scores: Record<number, number>, date = today()): LineCard[] {
  const bad = mine.filter((i) => !(scores[i] >= LINE_PASS))
  const rest = list.filter((c) => !bad.some((i) => same(c, { s: season, e: ep, i })))
  return [...rest, ...bad.map((i) => ({ s: season, e: ep, i, box: 0, due: addDays(date, 1) }))].slice(-LINE_MAX)
}
/** 复习一句：读好了往后推，读完最后一轮就移出；没读好明天再来 */
export function gradeLine(list: LineCard[], ref: { s: number; e: number; i: number }, score: number, date = today()): LineCard[] {
  return list.flatMap((c) => {
    if (!same(c, ref)) return [c]
    if (score < LINE_PASS) return [{ ...c, box: 0, due: addDays(date, 1) }]
    const box = c.box + 1
    return box >= LINE_GAPS.length ? [] : [{ ...c, box, due: addDays(date, LINE_GAPS[box]) }]
  })
}
export const dueLineCards = (list: LineCard[], date = today()) => list.filter((c) => c.due <= date).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))

export const getLineCards = () => kvGet<LineCard[]>('ep_lines', [])
export async function queueLines(season: number, ep: number, mine: number[], scores: Record<number, number>) {
  await kvSet('ep_lines', enqueueLines(await getLineCards(), season, ep, mine, scores))
}
export async function reviewLine(ref: { s: number; e: number; i: number }, score: number) {
  await kvSet('ep_lines', gradeLine(await getLineCards(), ref, score))
}

export type DueLine = { ref: { s: number; e: number; i: number }; en: string; zh: string; clip: { text: string; ep?: string }; from: string }
/** 今天到期的台词（按当前名字 / 声音取文字和配音）；找不到的（内容改过）跳过 */
export async function dueLines(n: number): Promise<DueLine[]> {
  if (n <= 0) return []
  const cards = dueLineCards(await getLineCards())
  if (!cards.length) return []
  const [all, me] = await Promise.all([loadSeasons(), getMe()])
  const out: DueLine[] = []
  for (const c of cards) {
    const s = all.find((x) => x.season === c.s)
    const ep = s?.episodes.find((x) => x.id === c.e)
    const l = ep?.lines[c.i]
    if (!s || !ep || !l) continue
    out.push({ ref: { s: c.s, e: c.e, i: c.i }, en: l.en, zh: l.zh, clip: clipOf(c.s, c.e, c.i, l, me, l.who === meKey(s)), from: `${c.s > 1 ? `第 ${c.s} 季` : ''}第 ${c.e} 集 · ${ep.title_zh}` })
    if (out.length >= n) break
  }
  return out
}

// 剧集（方案 1.2）：一天解锁一集，制造“明天还想打开”。第一季 Life in London，第二季 Edinburgh……
// 每集：听（逐句播放，角色各自的声音）→ 演（你演林，逐句跟读打分）→ 测（3 道听力理解题）→ 收生词
import { kvGet, kvSet, today } from './db'
import { loadContent, lookup, type Word } from './content'

export type Line = { who: string; en: string; zh: string }
export type Episode = { id: number; level: string; title: string; title_zh: string; scene_zh: string; lines: Line[]; quiz: { q: string; options: string[]; answer: number }[]; next_zh: string }
export type Season = { season: number; title: string; title_zh: string; cast: Record<string, { zh: string; voice: string | Record<string, string>; me?: boolean }>; episodes: Episode[] }
type Done = { date: string; quiz: number; act: number | null }
/** done 的键是 "季:集"（v0.0.4 第一版只有第一季，键是集号，读的时候换算） */
export type EpProgress = { done: Record<string, Done> }

export const SEASONS = [1, 2, 3]
let cache: Promise<Season[]> | null = null
export const loadSeasons = (): Promise<Season[]> => (cache ??= Promise.all(SEASONS.map((n) => fetch(`./content/episodes-s${n}.json`).then((r) => r.json()))))
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

export async function finish(season: number, ep: number, quiz: number, act: number | null) {
  const p = await getProgress()
  const k = key(season, ep)
  const old = p.done[k]
  p.done[k] = { date: old?.date ?? today(), quiz: Math.max(quiz, old?.quiz ?? 0), act: act ?? old?.act ?? null }
  await kvSet('ep_progress', p)
}

export const clipOf = (season: number, ep: number, i: number, text: string) => ({ text, ep: `s${season}e${ep}-${i}` })

/** 这一集里值得学的词：词表里有、不太基础、还没进词卡的（按难度从易到难，最多 6 个） */
export async function episodeWords(ep: Episode, have: Set<string>, frontier: number): Promise<Word[]> {
  const { byWord } = await loadContent()
  const seen = new Set<string>()
  const out: Word[] = []
  for (const l of ep.lines) for (const t of l.en.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []) {
    const w = lookup(byWord, t)
    if (!w || seen.has(w.w) || have.has(w.w) || w.sensitive || w.rank < Math.max(600, frontier * 0.6)) continue
    seen.add(w.w)
    out.push(w)
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, 6)
}

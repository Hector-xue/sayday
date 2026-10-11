// 剧集《Life in London》（方案 1.2）：一天解锁一集，制造“明天还想打开”
// 每集：听（逐句播放，角色各自的声音）→ 演（你演林，逐句跟读打分）→ 测（3 道听力理解题）
import { kvGet, kvSet, today } from './db'
import { loadContent, lookup, type Word } from './content'

export type Line = { who: string; en: string; zh: string }
export type Episode = { id: number; level: string; title: string; title_zh: string; scene_zh: string; lines: Line[]; quiz: { q: string; options: string[]; answer: number }[]; next_zh: string }
export type Season = { season: number; title: string; title_zh: string; cast: Record<string, { zh: string; voice: string | Record<string, string>; me?: boolean }>; episodes: Episode[] }
export type EpProgress = { done: Record<number, { date: string; quiz: number; act: number | null }> }

let cache: Promise<Season> | null = null
export const loadSeason = (): Promise<Season> => (cache ??= fetch('./content/episodes-s1.json').then((r) => r.json()))

export const getProgress = () => kvGet<EpProgress>('ep_progress', { done: {} })

/** 第一集随时能看；之后每集要等上一集看完的第二天（按凌晨 4 点换日） */
export function unlocked(ep: number, p: EpProgress, now = today()): boolean {
  if (ep === 1) return true
  const prev = p.done[ep - 1]
  return !!prev && prev.date < now
}
export function nextUp(s: Season, p: EpProgress): { ep: Episode; state: 'ready' | 'tomorrow' | 'all-done' } {
  const first = s.episodes.find((e) => !p.done[e.id])
  if (!first) return { ep: s.episodes[s.episodes.length - 1], state: 'all-done' }
  return { ep: first, state: unlocked(first.id, p) ? 'ready' : 'tomorrow' }
}

export async function finish(ep: number, quiz: number, act: number | null) {
  const p = await getProgress()
  const old = p.done[ep]
  p.done[ep] = { date: old?.date ?? today(), quiz: Math.max(quiz, old?.quiz ?? 0), act: act ?? old?.act ?? null }
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

// 雅思阅读 / 听力练习：原创题（content/ielts/reading.json、listening.json），本机判分，不需要 AI
// 题型：tfng / ynng 判断，mc 单选，pick 从选项表里选（段落标题、摘要选词、配对），gap 填空（限词数）
import { db } from './db'

export type Item = { n: number; q: string; a: string | number | string[]; options?: string[]; at: string; why: string }
export type Group = { type: 'tfng' | 'ynng' | 'mc' | 'pick' | 'gap'; instr: string; instr_zh: string; title?: string; limit?: number; number?: boolean; options?: string[]; items: Item[] }
export type Passage = { n: number; title: string; title_zh: string; minutes: number; lettered?: boolean; paras: string[]; groups: Group[] }
export type Line = { who: string; en: string; say?: string }
export type Part = { n: number; title: string; context_zh: string; cast: Record<string, { name: string; voice: string }>; lines: Line[]; groups: Group[] }
export type ReadingTest = { id: number; passages: Passage[] }
export type ListeningTest = { id: number; parts: Part[] }

let rc: Promise<ReadingTest[]> | null = null
let lc: Promise<ListeningTest[]> | null = null
export const loadReading = () => (rc ??= fetch('./content/ielts-reading.json').then((r) => r.json()).then((j) => j.tests as ReadingTest[]))
export const loadListening = () => (lc ??= fetch('./content/ielts-listening.json').then((r) => r.json()).then((j) => j.tests as ListeningTest[]))

/** 每句台词的音频（音频包 e/ 目录，和剧集一起合成） */
export const clipOfLine = (test: number, part: number, i: number, l: Line) => ({ text: l.say ?? l.en, ep: `l${test}p${part}-${i}` })

export const TF = { tfng: [['T', 'TRUE'], ['F', 'FALSE'], ['NG', 'NOT GIVEN']], ynng: [['Y', 'YES'], ['N', 'NO'], ['NG', 'NOT GIVEN']] } as const
export const letter = (i: number) => String.fromCharCode(65 + i)

/** 填空答案规范化：大小写、首尾标点、多余空格、货币符号都不算错；拼写要对 */
export function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[£$€]/g, '').replace(/[’']/g, "'").replace(/[^\p{L}\p{N}'.:\s-]/gu, ' ').replace(/(^[\s.'-]+|[\s.'-]+$)/g, '').replace(/\s+/g, ' ')
}
const digits = (s: string) => s.replace(/[\s-]/g, '')

export type Answer = string | number | null

export function correct(g: Group, it: Item, ans: Answer): boolean {
  if (ans === null || ans === '') return false
  if (g.type === 'gap') {
    const u = norm(String(ans))
    if (!u) return false
    // 超过词数限制按雅思规则算错（一串数字算一个“数字”，不计入词数）
    const isNum = /^[\d\s.:-]+$/.test(u)
    if (g.limit && !isNum && u.split(' ').length > g.limit + (g.number ? 1 : 0)) return false
    return (it.a as string[]).some((x) => { const v = norm(x); return u === v || (/^[\d\s.:-]+$/.test(v) && digits(u) === digits(v)) })
  }
  return ans === it.a
}

/** 雅思 40 题原始分 → 分数（学术类阅读 / 听力的常用对照表）；不满 40 题按比例折算 */
const READING: [number, number][] = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5]]
const LISTENING: [number, number][] = [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [11, 4], [8, 3.5], [6, 3], [4, 2.5]]
export function band(kind: 'reading' | 'listening', raw: number, total = 40): number {
  const r = Math.round((raw * 40) / total)
  for (const [min, b] of kind === 'reading' ? READING : LISTENING) if (r >= min) return b
  return r > 0 ? 2 : 0
}
/** 雅思 7 分大约要 40 题对多少：阅读 30、听力 30 */
export const target7 = (total: number) => Math.ceil((30 * total) / 40)

export type Result = { right: number; total: number; marks: Record<number, boolean> }
export function grade(groups: Group[], answers: Record<number, Answer>): Result {
  const marks: Record<number, boolean> = {}
  for (const g of groups) for (const it of g.items) marks[it.n] = correct(g, it, answers[it.n] ?? null)
  const v = Object.values(marks)
  return { right: v.filter(Boolean).length, total: v.length, marks }
}

/** 一次练习 = 一篇文章 / 一个部分（part）或整套（part = 0） */
export async function savePractice(kind: 'reading' | 'listening', test: number, part: number, r: Result, answers: Record<number, Answer>) {
  await db.run('INSERT INTO practice(ts, kind, test, part, score, total, band, answers) VALUES (?,?,?,?,?,?,?,?)', [Date.now(), kind, test, part, r.right, r.total, band(kind, r.right, r.total), JSON.stringify(answers)])
}
export type PracticeRow = { id: number; ts: number; kind: string; test: number; part: number; score: number; total: number; band: number }
export const practiceHistory = (kind?: string) =>
  db.all<PracticeRow>(`SELECT id, ts, kind, test, part, score, total, band FROM practice ${kind ? 'WHERE kind = ?' : ''} ORDER BY ts DESC LIMIT 50`, kind ? [kind] : [])

/** 进步页用：最近 5 次（按题数加权）折算的分数 */
export async function practiceBand(kind: 'reading' | 'listening'): Promise<{ band: number; n: number } | null> {
  const rows = await db.all<{ score: number; total: number }>('SELECT score, total FROM practice WHERE kind = ? ORDER BY ts DESC LIMIT 5', [kind])
  if (!rows.length) return null
  const s = rows.reduce((a, r) => a + r.score, 0), t = rows.reduce((a, r) => a + r.total, 0)
  return { band: band(kind, s, t), n: t }
}

// 雅思口语模考：Part 1 两个话题 6 问 → Part 2 话题卡（准备 1 分钟、说 1~2 分钟）→ Part 3 三问
// 每段回答：本机识别成文字 + 流利度指标 + 发音分（短的整段打分，长的取前 40 秒）
// 有 AI：按官方四项（流利连贯 / 词汇 / 语法 / 发音）给分和建议；没 AI：只给流利度和发音两项的客观参考
import { db } from './db'
import { completeJson, type AiConfig } from './ai'
import type { Fluency } from './fluency'

export type Card = { card: string; card_zh: string; points: string[]; part3: string[] }
export type Bank = { part1: { topic: string; topic_zh: string; q: string[] }[]; part2: Card[] }
let cache: Promise<Bank> | null = null
export const loadBank = (): Promise<Bank> => (cache ??= fetch('./content/ielts-speaking.json').then((r) => r.json()))

export type Q = { part: 1 | 2 | 3; text: string; maxSec: number; card?: Card }
export type Answer = { q: Q; transcript: string; fluency: Fluency; pron: number | null }

const pick = <T,>(a: T[], n: number, rnd = Math.random) => [...a].map((x) => [rnd(), x] as const).sort((p, q) => p[0] - q[0]).slice(0, n).map((x) => x[1])

export function buildTest(b: Bank, rnd = Math.random): Q[] {
  const topics = pick(b.part1, 2, rnd)
  const card = pick(b.part2, 1, rnd)[0]
  return [
    ...topics.flatMap((t) => pick(t.q, 3, rnd).map((text) => ({ part: 1 as const, text, maxSec: 45 }))),
    { part: 2, text: card.card, maxSec: 120, card },
    ...card.part3.map((text) => ({ part: 3 as const, text, maxSec: 75 })),
  ]
}

export type Grade = { fc: number; lr: number; gra: number; p: number; overall: number; summary: string; tips: string[]; better: { q: string; answer: string } | null }

const isGrade = (x: any): x is Grade => !!x && ['fc', 'lr', 'gra', 'p'].every((k) => typeof x[k] === 'number' && x[k] >= 0 && x[k] <= 9) && typeof x.summary === 'string' && Array.isArray(x.tips)

/** 四项取平均，按雅思规则就近取到 0.5 */
export const roundBand = (x: number) => Math.round(x * 2) / 2

/** 本 App 的整句发音分（0~100）→ 雅思发音档的粗略对照，只给 AI 当参考 */
export const pronHint = (s: number | null) => (s === null ? 'unknown' : s >= 85 ? 'about band 7-8' : s >= 70 ? 'about band 6-7' : s >= 55 ? 'about band 5-6' : 'about band 4-5')

export function gradePrompt(answers: Answer[]): string {
  const lines = answers.map((a, i) => `Q${i + 1} (Part ${a.q.part}): ${a.q.text}\nTranscript: ${a.transcript || '(nothing recognised)'}\nSpeaking time ${a.fluency.speakSec}s, ${a.fluency.wpm ?? '?'} words/min, ${a.fluency.pauses} pauses of 0.5s+, longest pause ${a.fluency.longestPause}s, pronunciation score ${a.pron ?? '?'}/100`).join('\n\n')
  const pr = answers.map((a) => a.pron).filter((x): x is number => x !== null)
  const avg = pr.length ? Math.round(pr.reduce((s, x) => s + x, 0) / pr.length) : null
  return `A Chinese candidate took a practice IELTS Speaking test. Transcripts come from offline speech recognition, so ignore odd words that look like recognition errors and do not judge punctuation.
Average pronunciation score from a phoneme-level scorer: ${avg ?? 'unknown'}/100 (${pronHint(avg)}). Use it as evidence for Pronunciation together with how intelligible the transcripts are.

${lines}

Return ONLY JSON:
{"fc": <Fluency and Coherence band 0-9, halves allowed>, "lr": <Lexical Resource>, "gra": <Grammatical Range and Accuracy>, "p": <Pronunciation>, "summary": "<2 sentences in Simplified Chinese: overall level and the biggest strength>", "tips": ["<3 specific, actionable tips in Simplified Chinese, quoting the candidate's own words where possible>"], "better": {"q": "<one question they answered weakly>", "answer": "<a natural band-7 answer to it, 3-5 sentences, reusing some of their ideas>"}}`
}

export async function gradeWithAi(cfg: AiConfig, answers: Answer[]): Promise<Grade> {
  const r = await completeJson(cfg, { system: 'You are an experienced IELTS Speaking examiner. Be accurate and fair, not generous.', messages: [{ role: 'user', content: gradePrompt(answers) }], maxTokens: 1400 }, isGrade)
  return { ...r, tips: r.tips.slice(0, 4), better: r.better && typeof r.better.answer === 'string' ? r.better : null, overall: roundBand((r.fc + r.lr + r.gra + r.p) / 4) }
}

/** 没接 AI 时的客观参考：只看流利度和发音（词汇、语法要 AI 读文字才能评） */
export function objectiveBands(answers: Answer[]): { fc: number | null; p: number | null } {
  const sp = answers.filter((a) => a.fluency.wpm !== null)
  const pr = answers.map((a) => a.pron).filter((x): x is number => x !== null)
  let fc: number | null = null
  if (sp.length) {
    const wpm = sp.reduce((s, a) => s + a.fluency.wpm!, 0) / sp.length
    const mins = Math.max(0.2, sp.reduce((s, a) => s + a.fluency.speakSec, 0) / 60)
    const pausesPerMin = sp.reduce((s, a) => s + a.fluency.pauses, 0) / mins
    // 语速 100 词/分以上、每分钟停顿不超过 6 次大致对应 7；按偏离程度往下扣
    fc = roundBand(Math.max(4, Math.min(8, 7 - Math.max(0, (100 - wpm) / 20) - Math.max(0, (pausesPerMin - 6) / 3))))
  }
  const avg = pr.length ? pr.reduce((s, x) => s + x, 0) / pr.length : null
  const p = avg === null ? null : roundBand(Math.max(4, Math.min(8, 4 + (avg - 45) / 10)))
  return { fc, p }
}

export async function saveTest(answers: Answer[], grade: Grade | null, objective: { fc: number | null; p: number | null }) {
  await db.run('INSERT INTO speaking_test(ts, band, data) VALUES (?,?,?)', [Date.now(), grade?.overall ?? null, JSON.stringify({ answers, grade, objective })])
}
export async function lastTests(n = 5) {
  return db.all<{ id: number; ts: number; band: number | null; data: string }>('SELECT * FROM speaking_test ORDER BY ts DESC LIMIT ?', [n])
}

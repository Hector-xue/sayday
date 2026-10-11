// 雅思写作批改（Task 2 大作文 / G 类书信）：AI 按官方四项打分，逐句改错，给一版 7 分以上的改写
import { db } from './db'
import { completeJson, type AiConfig } from './ai'
import { roundBand } from './ielts'

export type Prompt = { id: string; prompt: string; zh: string; type?: string }
export type WBank = { task2: Prompt[]; letters: Prompt[] }
let cache: Promise<WBank> | null = null
export const loadWriting = (): Promise<WBank> => (cache ??= fetch('./content/ielts-writing.json').then((r) => r.json()))

export type WEdit = { from: string; to: string; why: string }
export type WResult = {
  tr: number; cc: number; lr: number; gra: number; overall: number
  summary: string; strengths: string[]; improve: string[]; edits: WEdit[]; rewrite: string; phrases: { en: string; zh: string }[]
}

const isResult = (x: any): x is WResult =>
  !!x && ['tr', 'cc', 'lr', 'gra'].every((k) => typeof x[k] === 'number' && x[k] >= 0 && x[k] <= 9) && typeof x.summary === 'string' &&
  Array.isArray(x.edits) && x.edits.every((e: any) => typeof e?.from === 'string' && typeof e?.to === 'string') && typeof x.rewrite === 'string'

export const words = (t: string) => (t.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) || []).length
export const minWords = (letter: boolean) => (letter ? 150 : 250)

export function writingPrompt(p: Prompt, letter: boolean, text: string) {
  return `Grade this IELTS ${letter ? 'General Training Writing Task 1 (letter)' : 'Writing Task 2 (essay)'} answer written by a Chinese candidate.

Question:
${p.prompt}

Answer (${words(text)} words; the minimum is ${minWords(letter)}):
"""
${text}
"""

Use the official public band descriptors: ${letter ? 'Task Achievement' : 'Task Response'}, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy. Be accurate, not generous; penalise under-length answers as the descriptors say.

Return ONLY JSON:
{"tr": <band 0-9, halves allowed>, "cc": <band>, "lr": <band>, "gra": <band>,
 "summary": "<2 sentences in Simplified Chinese: estimated level and the single most important problem>",
 "strengths": ["<1-2 specific strengths in Simplified Chinese>"],
 "improve": ["<3 specific, actionable improvements in Simplified Chinese, quoting their words>"],
 "edits": [{"from": "<exact wrong fragment copied from the answer>", "to": "<corrected fragment>", "why": "<short reason in Simplified Chinese>"}],
 "rewrite": "<the whole answer rewritten at band 7.5, keeping their ideas and structure>",
 "phrases": [{"en": "<useful phrase from the rewrite>", "zh": "<Chinese>"}]}
At most 10 edits, real mistakes only; 4 phrases.`
}

export async function gradeWriting(cfg: AiConfig, p: Prompt, letter: boolean, text: string): Promise<WResult> {
  const r = await completeJson(cfg, { system: 'You are a certified IELTS Writing examiner and a kind, precise teacher.', messages: [{ role: 'user', content: writingPrompt(p, letter, text) }], maxTokens: 3000 }, isResult)
  return { ...r, strengths: r.strengths ?? [], improve: r.improve ?? [], phrases: r.phrases ?? [], overall: roundBand((r.tr + r.cc + r.lr + r.gra) / 4) }
}

export async function saveWriting(promptId: string, text: string, r: WResult | null) {
  await db.run('INSERT INTO writing(ts, prompt_id, text, band, result) VALUES (?,?,?,?,?)', [Date.now(), promptId, text, r?.overall ?? null, r ? JSON.stringify(r) : null])
}
export async function writingHistory(n = 20) {
  const rows = await db.all<{ id: number; ts: number; prompt_id: string; text: string; band: number | null; result: string | null }>('SELECT * FROM writing ORDER BY ts DESC LIMIT ?', [n])
  return rows.map((r) => ({ ...r, result: r.result ? (JSON.parse(r.result) as WResult) : null }))
}
/** 草稿：写到一半退出不丢（按题目存） */
export const draftKey = (id: string) => `writing_draft_${id}`

// 工作英语（方案 1.4）：跨境电商的真实场景——回买家邮件、给供应商发消息、写 Listing。
// 写完由你接入的 AI 批改（语气是否得体、有没有说清楚、逐句改错、一版地道写法）；没接 AI 也能对照参考写法
import { db } from './db'
import { completeJson, type AiConfig } from './ai'

export type Task = {
  id: string; kind: 'email' | 'message' | 'review' | 'listing'; title_zh: string; level: string
  material: string; task_zh: string; hints_zh: string[]; phrases: { en: string; zh: string }[]; model: string
}
export const KIND_ZH: Record<Task['kind'], string> = { email: '邮件', message: '消息', review: '公开回复', listing: 'Listing' }

let cache: Promise<Task[]> | null = null
export const loadTasks = (): Promise<Task[]> => (cache ??= fetch('./content/work.json').then((r) => r.json()).then((j) => j.tasks))

export type WorkEdit = { from: string; to: string; why: string }
export type WorkResult = { score: number; tone: string; covered: string[]; missing: string[]; edits: WorkEdit[]; better: string; phrases: { en: string; zh: string }[]; comment: string }

const isResult = (x: any): x is WorkResult =>
  !!x && typeof x.score === 'number' && x.score >= 0 && x.score <= 10 && typeof x.better === 'string' && typeof x.comment === 'string' &&
  Array.isArray(x.edits) && x.edits.every((e: any) => typeof e?.from === 'string' && typeof e?.to === 'string')

export function workPrompt(t: Task, text: string) {
  return `A Chinese cross-border e-commerce seller is practising business English. Check their writing for this task.

Situation and task (in Chinese): ${t.task_zh}
${t.material ? `What they received:\n"""\n${t.material}\n"""\n` : ''}Their ${t.kind === 'listing' ? 'listing text' : t.kind}:
"""
${text}
"""

Judge it like an experienced e-commerce manager who is also a kind English teacher: is it clear, polite, the right tone for the reader, and does it do everything the task asks?${t.kind === 'listing' ? ' For listings, also follow Amazon style rules: no promotional claims like "best" or "No.1", no keyword stuffing.' : ''}

Return ONLY JSON:
{"score": <0-10, one decimal; 7 = a customer or supplier would be happy to receive it>,
 "tone": "<one short sentence in Simplified Chinese about the tone, e.g. 礼貌得体 / 有点生硬>",
 "covered": ["<task points they handled well, Simplified Chinese>"],
 "missing": ["<task points missing or unclear, Simplified Chinese; empty if none>"],
 "edits": [{"from": "<exact fragment copied from their text>", "to": "<better fragment>", "why": "<short reason in Simplified Chinese>"}],
 "better": "<their text rewritten as a native professional would write it, keeping their ideas; it must be grammatically flawless with consistent tenses>",
 "phrases": [{"en": "<useful phrase from the rewrite>", "zh": "<Chinese>"}],
 "comment": "<one or two encouraging sentences in Simplified Chinese with the single most important thing to improve>"}
At most 8 edits, real grammar / word-choice / tone / content problems only (not line breaks or layout); 4 phrases.`
}

export async function checkWork(cfg: AiConfig, t: Task, text: string): Promise<WorkResult> {
  const r = await completeJson(cfg, { system: 'You are a senior e-commerce manager and a precise, encouraging business English teacher.', messages: [{ role: 'user', content: workPrompt(t, text) }], maxTokens: 2500 }, isResult)
  return { ...r, covered: r.covered ?? [], missing: r.missing ?? [], phrases: r.phrases ?? [], tone: r.tone ?? '' }
}

export async function saveWork(task: string, text: string, r: WorkResult | null) {
  await db.run('INSERT INTO work(ts, task, text, score, result) VALUES (?,?,?,?,?)', [Date.now(), task, text, r?.score ?? null, r ? JSON.stringify(r) : null])
}
export async function workHistory(n = 30) {
  const rows = await db.all<{ id: number; ts: number; task: string; text: string; score: number | null; result: string | null }>('SELECT * FROM work ORDER BY ts DESC LIMIT ?', [n])
  return rows.map((r) => ({ ...r, result: r.result ? (JSON.parse(r.result) as WorkResult) : null }))
}
export const workDraftKey = (id: string) => `work_draft_${id}`

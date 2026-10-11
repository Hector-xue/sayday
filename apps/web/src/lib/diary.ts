// 双语日记（方案 1.4）：写几句今天的事（英文、中英混写、纯中文都行）→ AI 逐句改错并说明原因、给一版更地道的、挑几个值得学的表达
import { db, today } from './db'
import { completeJson, type AiConfig } from './ai'
import type { Cefr } from './levels'

export type Edit = { from: string; to: string; why: string }
export type DiaryResult = { corrected: string; edits: Edit[]; natural: string; phrases: { en: string; zh: string }[]; comment: string }
export type Entry = { id: number; date: string; text: string; result: DiaryResult | null; ts: number }

const isResult = (x: any): x is DiaryResult =>
  x && typeof x.corrected === 'string' && Array.isArray(x.edits) && typeof x.natural === 'string' && Array.isArray(x.phrases) && typeof x.comment === 'string' &&
  x.edits.every((e: any) => typeof e?.from === 'string' && typeof e?.to === 'string') && x.phrases.every((p: any) => typeof p?.en === 'string')

export function diaryPrompt(level: Cefr, text: string) {
  return `A Chinese learner of English (level ${level}) wrote this diary entry. It may mix Chinese and English.

"""
${text}
"""

Return ONLY a JSON object:
{
  "corrected": "<the learner's text with only the necessary corrections, Chinese parts translated to English; keep their meaning and style>",
  "edits": [{"from": "<original wrong part>", "to": "<fixed part>", "why": "<short reason in Simplified Chinese>"}],
  "natural": "<the same diary rewritten as a native speaker would write it, at about level ${level} (slightly above is fine)>",
  "phrases": [{"en": "<useful expression from your natural version>", "zh": "<Chinese meaning>"}],
  "comment": "<one or two sentences in Simplified Chinese: something specific they did well, and the single most useful thing to improve>"
}
Rules: at most 8 edits, only real mistakes (not style); for Chinese parts, add an edit {"from": "<the Chinese>", "to": "<English>", "why": "用英文可以这样说"}; 3 phrases; never invent content they did not write.`
}

export async function correct(cfg: AiConfig, level: Cefr, text: string): Promise<DiaryResult> {
  return completeJson(cfg, { system: 'You are a kind, precise English writing tutor.', messages: [{ role: 'user', content: diaryPrompt(level, text) }], maxTokens: 1500 }, isResult)
}

export async function saveEntry(text: string, result: DiaryResult | null, id?: number): Promise<number> {
  if (id) {
    await db.run('UPDATE diary SET text = ?, result = ?, ts = ? WHERE id = ?', [text, result ? JSON.stringify(result) : null, Date.now(), id])
    return id
  }
  await db.run('INSERT INTO diary(date, text, result, ts) VALUES (?,?,?,?)', [today(), text, result ? JSON.stringify(result) : null, Date.now()])
  return (await db.one<{ id: number }>('SELECT max(id) id FROM diary'))!.id
}

export async function entries(limit = 30): Promise<Entry[]> {
  const rows = await db.all<{ id: number; date: string; text: string; result: string | null; ts: number }>('SELECT * FROM diary ORDER BY ts DESC LIMIT ?', [limit])
  return rows.map((r) => ({ ...r, result: r.result ? JSON.parse(r.result) : null }))
}

export const deleteEntry = (id: number) => db.run('DELETE FROM diary WHERE id = ?', [id])

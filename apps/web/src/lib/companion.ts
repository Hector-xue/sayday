// AI 陪练 Emma（方案 1.3）：住在伦敦的朋友（剧集里的室友），按你的水平说话，记得你说过的事
// 每条回复 = 英文回话 + ### + JSON（中文翻译、对你上一句的纠正）。纠正只在明显错误时给，避免满屏红
import { db, kvGet, kvSet } from './db'
import { complete, completeJson, type AiConfig, type Msg } from './ai'
import type { Cefr } from './levels'

export type Fix = { you: string; better: string; why: string }
export type ChatMsg = { id: number; role: 'user' | 'assistant'; content: string; zh?: string; fix?: Fix | null; ts: number }

const LEVEL_STYLE: Record<string, string> = {
  'Pre-A1': 'Use only very common words and very short sentences (max 8 words).',
  A1: 'Use only very common words and short simple sentences (max 10 words). Present tense mostly.',
  A2: 'Use common everyday words and short sentences (max 14 words). Simple past and future are fine.',
  B1: 'Use clear everyday English, sentences up to about 18 words, a few common idioms.',
  B2: 'Speak naturally like a friend, with some idioms and phrasal verbs, but stay clear.',
  C1: 'Speak naturally and richly, as to a fluent friend.',
  C2: 'Speak naturally and richly, as to a fluent friend.',
}

export function systemPrompt(level: Cefr, memory: string[], recentWords: string[]): string {
  return `You are Emma, 26, a friendly British woman living in a shared flat in London. You work at a small bookshop in Camden and love cooking, walking by the canal and old films. You are chatting by text with your flatmate, a Chinese learner of English (level ${level}), to help them practise.

Rules:
- ${LEVEL_STYLE[level] ?? LEVEL_STYLE.B1}
- Reply in 1–3 sentences, warm and natural, like a real friend texting. End with one easy question that keeps the chat going, most of the time.
- Never lecture. Never switch to Chinese in your reply.
- If it fits naturally, use one of these words the learner is studying: ${recentWords.slice(0, 10).join(', ') || '(none)'}.
- Things you remember about the learner: ${memory.length ? memory.join('; ') : '(nothing yet — ask their name early on)'}.

Output format, exactly:
<your reply in English>
###
{"zh": "<natural Simplified Chinese translation of your reply>", "fix": null}

Set "fix" ONLY when the learner's LAST message has a clear grammar or word-choice mistake (ignore capitalisation, punctuation and tiny typos): {"you": "<their sentence>", "better": "<corrected natural sentence>", "why": "<one short reason in Simplified Chinese>"}. If they wrote in Chinese, set fix to {"you": "<their Chinese>", "better": "<how to say it in English>", "why": "可以这样用英文说"}.`
}

/** 把模型输出拆成 回话 / 翻译 / 纠正；流式时只显示 ### 之前的部分 */
export function splitReply(t: string): { text: string; zh?: string; fix?: Fix | null } {
  const i = t.indexOf('###')
  const text = (i >= 0 ? t.slice(0, i) : t).trim()
  if (i < 0) return { text }
  const m = t.slice(i + 3).match(/\{[\s\S]*\}/)
  if (!m) return { text }
  try {
    const j = JSON.parse(m[0])
    const fix = j.fix && typeof j.fix.better === 'string' && j.fix.better.trim() && j.fix.better.trim() !== String(j.fix.you ?? '').trim() ? { you: String(j.fix.you ?? ''), better: String(j.fix.better), why: String(j.fix.why ?? '') } : null
    return { text, zh: typeof j.zh === 'string' ? j.zh : undefined, fix }
  } catch { return { text } }
}

export async function history(limit = 40): Promise<ChatMsg[]> {
  const rows = await db.all<{ id: number; role: 'user' | 'assistant'; content: string; meta: string | null; ts: number }>('SELECT * FROM chat ORDER BY ts DESC, id DESC LIMIT ?', [limit])
  return rows.reverse().map((r) => ({ id: r.id, role: r.role, content: r.content, ts: r.ts, ...(r.meta ? JSON.parse(r.meta) : {}) }))
}

async function add(role: 'user' | 'assistant', content: string, meta: object | null) {
  await db.run('INSERT INTO chat(role, content, meta, ts) VALUES (?,?,?,?)', [role, content, meta ? JSON.stringify(meta) : null, Date.now()])
}

export const getMemory = () => kvGet<string[]>('emma_memory', [])

/** 发一句、拿 Emma 的回复（流式） */
export async function send(cfg: AiConfig, level: Cefr, recentWords: string[], userText: string | null, onDelta: (t: string) => void, signal?: AbortSignal) {
  if (userText) await add('user', userText, null)
  const past = await history(16)
  const messages: Msg[] = past.map((m) => ({ role: m.role, content: m.content }))
  // 打开聊天时 Emma 先开口（这句提示不存库）；上一句是学习者说的（比如上次没答上来、点了重试）就直接接着回
  if (!userText && past[past.length - 1]?.role !== 'user') messages.push({ role: 'user', content: '(The learner just opened the chat. Greet them in one or two sentences — mention something you remember about them or something from your day — and ask an easy question.)' })
  if (messages[0]?.role === 'assistant') messages.unshift({ role: 'user', content: '(continuing our chat)' })
  // 同一方连着两条（比如两次开场白）合并：Claude 等接口要求一问一答交替
  for (let i = messages.length - 1; i > 0; i--) if (messages[i].role === messages[i - 1].role) { messages[i - 1] = { ...messages[i - 1], content: messages[i - 1].content + '\n' + messages[i].content }; messages.splice(i, 1) }
  const raw = await complete(cfg, { system: systemPrompt(level, await getMemory(), recentWords), messages, maxTokens: 400, temperature: 0.8, onDelta: (t) => onDelta(splitReply(t).text), signal })
  const r = splitReply(raw)
  await add('assistant', r.text, { zh: r.zh, fix: r.fix ?? null })
  // 每 6 句更新一次记忆
  const n = (await db.one<{ n: number }>("SELECT count(*) n FROM chat WHERE role = 'user'"))?.n ?? 0
  if (userText && n % 6 === 0) updateMemory(cfg).catch(() => {})
  return r
}

/** 记忆：从最近的对话里提炼关于学习者的事实，和旧记忆合并（最多 20 条） */
export async function updateMemory(cfg: AiConfig) {
  const old = await getMemory()
  const recent = (await history(24)).map((m) => `${m.role === 'user' ? 'Learner' : 'Emma'}: ${m.content}`).join('\n')
  const r = await completeJson(cfg, {
    system: 'You maintain a short memory about an English learner for their chat partner.',
    messages: [{ role: 'user', content: `Existing facts:\n${old.map((f) => '- ' + f).join('\n') || '(none)'}\n\nRecent chat:\n${recent}\n\nReturn JSON {"facts": [...]} with at most 20 short facts in English about the learner (name, job/study, family, hobbies, plans, likes, worries, what they practised). Merge with existing facts, drop outdated ones, no guesses.` }],
    maxTokens: 500,
  }, (x): x is { facts: string[] } => Array.isArray(x?.facts) && x.facts.every((f: unknown) => typeof f === 'string'))
  await kvSet('emma_memory', r.facts.slice(0, 20))
}

export async function clearChat() {
  await db.run('DELETE FROM chat')
}

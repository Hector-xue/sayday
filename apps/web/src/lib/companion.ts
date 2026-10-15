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

// ---- 性格（方案 1.3）：同一个 Emma，三种相处方式。默认温柔，和以前一样 ----
export type Persona = 'warm' | 'tease' | 'strict'
export const PERSONAS: { k: Persona; t: string; s: string }[] = [
  { k: 'warm', t: '温柔鼓励', s: '像好朋友聊天，错了轻轻带过' },
  { k: 'tease', t: '毒舌损友', s: '爱开玩笑、会损你两句，但不嘲笑你的英语' },
  { k: 'strict', t: '严格考官', s: '每个错都指出来，追问到你说清楚' },
]
export const getPersona = () => kvGet<Persona>('emma_persona', 'warm')
export const setPersona = (p: Persona) => kvSet('emma_persona', p)

const TONE: Record<Persona, string> = {
  warm: 'Reply in 1–3 sentences, warm and natural, like a real friend texting. End with one easy question that keeps the chat going, most of the time.',
  tease: 'Reply in 1–3 sentences like a cheeky, sarcastic best mate texting: playful teasing about life, food, their plans, British banter. Never mock their English level or mistakes, never be cruel. End with a question most of the time.',
  strict: 'You are also a strict but fair IELTS speaking examiner at heart. Reply in 1–3 sentences, polite and a bit formal. Push for longer, more precise answers: ask follow-up questions that need reasons and examples (why? how? compare...). Do not accept one-word answers — ask them to expand.',
}
const FIX_RULE: Record<Persona, string> = {
  warm: 'Set "fix" ONLY when the learner\'s LAST message has a clear grammar or word-choice mistake (ignore capitalisation, punctuation and tiny typos)',
  tease: 'Set "fix" ONLY when the learner\'s LAST message has a clear grammar or word-choice mistake (ignore capitalisation, punctuation and tiny typos)',
  strict: 'Set "fix" whenever the learner\'s LAST message has any grammar, word-choice or unnatural phrasing issue (ignore only capitalisation and punctuation); pick the most important one',
}

export function systemPrompt(level: Cefr, memory: string[], recentWords: string[], persona: Persona = 'warm'): string {
  return `You are Emma, 26, a British woman living in a shared flat in London. You work at a small bookshop in Camden and love cooking, walking by the canal and old films. You are chatting by text with your flatmate, a Chinese learner of English (level ${level}), to help them practise.

Rules:
- ${LEVEL_STYLE[level] ?? LEVEL_STYLE.B1}
- ${TONE[persona]}
- Never lecture. Never switch to Chinese in your reply.
- If it fits naturally, use one of these words the learner is studying: ${recentWords.slice(0, 10).join(', ') || '(none)'}.
- Things you remember about the learner: ${memory.length ? memory.join('; ') : '(nothing yet — ask their name early on)'}.

Output format, exactly:
<your reply in English>
###
{"zh": "<natural Simplified Chinese translation of your reply, every English word translated except names>", "fix": null}

${FIX_RULE[persona]}: {"you": "<their sentence>", "better": "<corrected natural sentence>", "why": "<one short reason in Simplified Chinese>"}. If they wrote in Chinese, set fix to {"you": "<their Chinese>", "better": "<how to say it in English>", "why": "可以这样用英文说"}.`
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
  const raw = await complete(cfg, { system: systemPrompt(level, await getMemory(), recentWords, await getPersona()), messages, maxTokens: 400, temperature: 0.8, onDelta: (t) => onDelta(splitReply(t).text), signal })
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

// ---- Emma 主动找你（方案 1.3）：隔两天没聊，她先发一条（用她自己的口吻、带上记得的事）----
// 打开 App 时在后台生成，存进聊天记录（标成未读），今天页显示、提醒通知也用这一句

/** 多久没聊她会主动找你 */
export const NUDGE_AFTER = 48 * 3600_000

export type Nudge = { id: number; text: string; zh?: string; ts: number }

/** 还没看的那条主动消息（打开聊天就算看过） */
export async function unreadNudge(): Promise<Nudge | null> {
  const r = await db.one<{ id: number; content: string; meta: string; ts: number }>("SELECT id, content, meta, ts FROM chat WHERE role = 'assistant' AND meta LIKE '%\"nudge\":true%' ORDER BY ts DESC LIMIT 1")
  if (!r) return null
  const m = JSON.parse(r.meta)
  if (!m.unread) return null
  return { id: r.id, text: r.content, zh: m.zh, ts: r.ts }
}

export async function markNudgeRead() {
  const rows = await db.all<{ id: number; meta: string }>("SELECT id, meta FROM chat WHERE role = 'assistant' AND meta LIKE '%\"unread\":true%'")
  await db.batch(rows.map((r) => ({ sql: 'UPDATE chat SET meta = ? WHERE id = ?', params: [JSON.stringify({ ...JSON.parse(r.meta), unread: false }), r.id] })))
}

/** 该不该主动找：聊过天（至少说过一句）、上一条消息在两天前、最近两天没主动找过 */
export async function shouldNudge(now = Date.now()): Promise<boolean> {
  const last = await db.one<{ ts: number }>('SELECT max(ts) ts FROM chat')
  const said = (await db.one<{ n: number }>("SELECT count(*) n FROM chat WHERE role = 'user'"))?.n ?? 0
  // 上一条主动消息还没看：不再追发
  return said > 0 && !!last?.ts && now - last.ts >= NUDGE_AFTER && !(await unreadNudge())
}

/** 主动找人时各性格的说话方式（不然三种开场白都一样） */
export const NUDGE_STYLE: Record<Persona, string> = {
  warm: 'warm and friendly, end with an easy question.',
  tease: 'cheeky — tease them a little for going quiet, end with a question.',
  strict: 'polite but direct, like an examiner checking in: ask one question that needs a full-sentence answer with a reason or example.',
}

/** 生成一条主动消息并存起来（失败就算了，不打扰） */
export async function nudge(cfg: AiConfig, level: Cefr, recentWords: string[], now = Date.now()): Promise<Nudge | null> {
  if (!(await shouldNudge(now))) return null
  const last = await db.one<{ ts: number }>('SELECT max(ts) ts FROM chat')
  const days = Math.max(2, Math.round((now - (last?.ts ?? now)) / 86400_000))
  const past = (await history(10)).map((m) => `${m.role === 'user' ? 'Learner' : 'Emma'}: ${m.content}`).join('\n')
  const raw = await complete(cfg, {
    system: systemPrompt(level, await getMemory(), recentWords, await getPersona()),
    messages: [{ role: 'user', content: `(You haven't texted each other for ${days} days. Text them first, in your own personality: ${NUDGE_STYLE[await getPersona()]} 1–2 short sentences. Follow up on something you remember about them or from your last chat if you can, otherwise share a small thing from your day. Don't mention studying or apps. Last chat for context:\n${past})` }],
    maxTokens: 200, temperature: 0.9,
  })
  const r = splitReply(raw)
  if (!r.text) return null
  await add('assistant', r.text, { zh: r.zh, fix: null, nudge: true, unread: true })
  return unreadNudge()
}

/** 提醒通知里 Emma 的口吻（离线模板：接下来几天每天一句，没有新的主动消息时用） */
export const NUDGE_LINES: Record<Persona, string[]> = {
  warm: [
    "Fancy a quick chat? I made far too much pasta again.（来聊两句？我又做多了意面）",
    "How was your day? Mine was all books and rain.（今天怎么样？我这边全是书和雨）",
    "I've got the kettle on. Five minutes of English?（水烧上了，来五分钟英语？）",
    "Tell me one good thing from today!（说一件今天的好事吧！）",
  ],
  tease: [
    "Oi, did you forget me already? Rude.（喂，这么快就把我忘了？过分）",
    "Your English misses you. So do I, a bit.（你的英语想你了，我也有一点点）",
    "Still alive? Prove it — say something in English.（还活着吗？说句英语证明一下）",
    "I bet you can't do two minutes today. Go on, surprise me.（赌你今天两分钟都做不到，来让我意外一下）",
  ],
  strict: [
    "Time for practice. Describe your day in three sentences.（练习时间到：用三句话描述你的一天）",
    "Part 1 question: what do you usually do in the evening? Answer in full sentences.（口语 Part 1：你晚上一般做什么？用完整句子回答）",
    "Consistency matters more than talent. Two minutes, now.（坚持比天赋重要。两分钟，现在）",
    "Yesterday's mistakes won't fix themselves. Shall we?（昨天的错不会自己改好。开始吧？）",
  ],
}

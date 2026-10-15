// 通知里做题（方案 1.1，仅安卓 App）：每天到点弹几道复习题，在通知里直接点按钮 / 快捷回复作答，不用打开 App。
// 出题在这里（从词卡里挑快到期的词），弹题和判对错在原生那边（Quiz.kt）；答过的题下次打开 App 时取回来，按作答时间记进复习。
// 默认关（老用户不受影响）；和每日提醒一样，打开 App、做完练习时重排
import { ensureNotifyPermission } from './system'
import { db, kvGet, kvSet } from './db'
import { grade, Rating } from './srs'
import { loadContent, type Word } from './content'

const tauri = (globalThis as any).__TAURI__?.core as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined
export const canQuiz = !!tauri
export type QuizCfg = { on: boolean; hour: number; minute: number }
export const getQuizCfg = () => kvGet<QuizCfg>('notify_quiz', { on: false, hour: 12, minute: 30 })

export type Question = { id: string; word: string; kind: 'choice' | 'spell'; prompt: string; hint: string; options?: string[]; answer: string; reveal: string }

/** 释义取第一个义项、去掉词性，按钮上放得下 */
export const shortZh = (w: Word) => w.zh.split(/[；;]/)[0].replace(/^[a-z]+\.\s*/i, '').split(/[,，]/).map((x) => x.trim()).slice(0, 2).join('，').slice(0, 12)

/**
 * 出一批题：快到期的词优先。熟一点的（复习过 2 次以上）出拼写题（看中文写英文），其余出选择题（看英文选意思，3 选 1）。
 * 干扰项从排名相近的词里挑，意思不能重复
 */
export function makeQuestions(cards: { word: string; reps: number }[], byWord: Map<string, Word>, words: Word[], n = 21, rnd = Math.random): Question[] {
  const out: Question[] = []
  for (const c of cards) {
    if (out.length >= n) break
    const w = byWord.get(c.word)
    if (!w) continue
    const zh = shortZh(w)
    if (!zh) continue
    if (c.reps >= 2 && w.w.length >= 3 && w.w.length <= 12 && /^[a-z]+$/.test(w.w)) {
      out.push({ id: `s-${w.w}`, word: w.w, kind: 'spell', prompt: `拼出这个词：${zh}`, hint: `${w.w.length} 个字母，${w.w[0]} 开头。点“写答案”直接输入`, answer: w.w, reveal: `${w.w}${w.ipa ? ` /${w.ipa}/` : ''}` })
      continue
    }
    const near = words.filter((x) => x.w !== w.w && Math.abs(x.rank - w.rank) < 800 && !x.sensitive).map(shortZh).filter((x) => x && x !== zh)
    const opts = new Set<string>()
    while (opts.size < 2 && near.length) opts.add(near.splice(Math.floor(rnd() * near.length), 1)[0])
    if (opts.size < 2) continue
    const options = [...opts]
    options.splice(Math.floor(rnd() * 3), 0, zh)
    out.push({ id: `c-${w.w}`, word: w.w, kind: 'choice', prompt: `“${w.w}”是什么意思？`, hint: w.ipa ? `/${w.ipa}/` : '', options, answer: zh, reveal: `${w.w} = ${zh}` })
  }
  return out
}

/** 接下来 7 天每天 hour:minute（已经过了的跳过） */
export function quizTimes(cfg: QuizCfg, now = new Date()): number[] {
  const out: number[] = []
  for (let k = 0; k < 7; k++) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, cfg.hour, cfg.minute).getTime()
    if (t > now.getTime() + 60_000) out.push(t)
  }
  return out
}

/** 取回通知里答过的题记进复习，再出新的一批交给原生（关着就清掉闹钟） */
export async function syncQuiz(): Promise<{ applied: number }> {
  if (!tauri) return { applied: 0 }
  let applied = 0
  try {
    const r = await tauri.invoke('plugin:sayday-infer|quiz_drain')
    const answers: { word: string; ok: boolean; ts: number }[] = JSON.parse(r?.answers ?? '[]')
    for (const a of answers) { await grade(a.word, a.ok ? Rating.Good : Rating.Again, undefined, new Date(a.ts)); applied++ }
  } catch { /* 旧版原生没有这个命令 */ }
  const cfg = await getQuizCfg()
  if (!cfg.on) { await tauri.invoke('plugin:sayday-infer|quiz_set', { questions: '[]', times: '[]' }).catch(() => {}); return { applied } }
  const { byWord, words } = await loadContent()
  const cards = await db.all<{ word: string; reps: number }>('SELECT word, reps FROM card WHERE known = 0 ORDER BY due LIMIT 60')
  const qs = makeQuestions(cards, byWord, words)
  await tauri.invoke('plugin:sayday-infer|quiz_set', { questions: JSON.stringify(qs), times: JSON.stringify(quizTimes(cfg)) }).catch(() => {})
  return { applied }
}

export async function enableQuiz(cfg: QuizCfg): Promise<string | null> {
  if (!tauri) return '网页版做不了，请用安卓 App'
  if (cfg.on) {
    if (!(await ensureNotifyPermission())) return '没有通知权限：到系统设置 → 应用 → 日日说 → 通知 里打开，再回来开'
  }
  await kvSet('notify_quiz', cfg)
  // 出题、排闹钟放后台：开关先翻过来，出错再提示
  syncQuiz().catch((e) => console.error(e))
  return null
}

/** 马上弹一轮（先把题交过去） */
export async function testQuiz(): Promise<string | null> {
  if (!tauri) return '网页版做不了'
  const cfg = await getQuizCfg()
  if (!cfg.on) { const e = await enableQuiz({ ...cfg, on: true }); if (e) return e }
  // 先把题交过去再弹（开关那里出题是放后台的）
  await syncQuiz()
  await tauri.invoke('plugin:sayday-infer|quiz_test')
  return null
}

// 声音日记（方案 1.5）：每周用同一段话录一次，第 1 周和第 N 周放在一起听——最直观的进步证据。
// 同一周重录覆盖（留最好听的那次由你自己决定）；录音只存本机，不进 JSON 备份
import { db, today } from './db'
import { weekStart } from './rhythm'
import { infer } from './speech/engine'
import { score } from './speech/score'
import { fluency } from './fluency'
import { wav16k } from './recordings'

/** 原创短文：覆盖中国学习者最常读不准的音（/θ/ /ð/ /v/ /w/ /r/ /l/ /ŋ/ /æ/ 长短元音、词尾辅音） */
export const PASSAGE = {
  en: "Every Thursday I walk through the old market by the river. I buy three fresh vegetables, a warm loaf of bread, and something sweet that I really shouldn't eat. Then I sit on the wall, watch the boats go by, and think about the week ahead.",
  zh: '每周四我都会穿过河边的老集市。买三样新鲜蔬菜、一个热乎的面包，再买点其实不该吃的甜食。然后坐在墙上看船慢慢开过去，想想接下来的一周。',
}

export type Entry = { id: number; week: string; score: number | null; wpm: number | null; pauses: number | null; sec: number; ts: number }

export async function entries(): Promise<Entry[]> {
  return db.all<Entry>('SELECT id, week, score, wpm, pauses, sec, ts FROM voice_diary ORDER BY week')
}

/** 本周录过没有 */
export async function thisWeek(now = today()): Promise<Entry | null> {
  return (await db.one<Entry>('SELECT id, week, score, wpm, pauses, sec, ts FROM voice_diary WHERE week = ?', [weekStart(now)])) ?? null
}

/** 打分（整段的发音分 + 语速 / 停顿），存进本周（覆盖本周旧的） */
export async function saveEntry(audio: Float32Array, now = new Date()): Promise<Entry> {
  let s: number | null = null
  try { s = (await score(PASSAGE.en, await infer(audio))).score } catch { /* 模型没就绪也照样存录音 */ }
  const f = fluency(audio, PASSAGE.en)
  // 语速按“整段都读了”算；快得离谱（每分钟 250 词以上）说明没读完，不记
  const wpm = f.wpm && f.wpm <= 250 ? f.wpm : null
  const pcm = new Int16Array(audio.length)
  for (let i = 0; i < audio.length; i++) pcm[i] = Math.max(-1, Math.min(1, audio[i])) * 32767
  const week = weekStart(today(now))
  const sec = audio.length / 16000
  await db.batch([
    { sql: 'DELETE FROM voice_diary WHERE week = ?', params: [week] },
    { sql: 'INSERT INTO voice_diary(week, pcm, score, wpm, pauses, sec, ts) VALUES (?,?,?,?,?,?,?)', params: [week, new Uint8Array(pcm.buffer), s, wpm, f.pauses, sec, now.getTime()] },
  ])
  return (await thisWeek(today(now)))!
}

let current: HTMLAudioElement | null = null
export async function playEntry(id: number): Promise<void> {
  const r = await db.one<{ pcm: Uint8Array }>('SELECT pcm FROM voice_diary WHERE id = ?', [id])
  if (!r) return
  const pcm = new Int16Array(r.pcm.buffer.slice(r.pcm.byteOffset, r.pcm.byteOffset + r.pcm.byteLength))
  current?.pause()
  const a = new Audio(URL.createObjectURL(wav16k(pcm)))
  current = a
  await a.play()
  await new Promise<void>((res) => { a.onended = () => res(); a.onpause = () => res() })
}
export const stopEntry = () => current?.pause()

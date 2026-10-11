// 录音前后对比：同一句的第一次和最近一次
import { db } from './db'

export type Pair = { text: string; first: { id: number; score: number; ts: number }; last: { id: number; score: number; ts: number } }

export async function recordingPairs(limit = 6): Promise<Pair[]> {
  const rows = await db.all<{ id: number; text: string; score: number; ts: number }>('SELECT id, text, score, ts FROM recording ORDER BY ts')
  const by = new Map<string, typeof rows>()
  for (const r of rows) by.set(r.text, [...(by.get(r.text) ?? []), r])
  const out: Pair[] = []
  for (const [text, rs] of by) if (rs.length >= 2) out.push({ text, first: rs[0], last: rs[rs.length - 1] })
  // 间隔越久越有看头
  return out.sort((a, b) => (b.last.ts - b.first.ts) - (a.last.ts - a.first.ts)).slice(0, limit)
}

let current: HTMLAudioElement | null = null
export async function playRecording(id: number): Promise<void> {
  const r = await db.one<{ pcm: Uint8Array }>('SELECT pcm FROM recording WHERE id = ?', [id])
  if (!r) return
  const pcm = new Int16Array(r.pcm.buffer.slice(r.pcm.byteOffset, r.pcm.byteOffset + r.pcm.byteLength))
  current?.pause()
  const a = new Audio(URL.createObjectURL(wav16k(pcm)))
  current = a
  await a.play()
  await new Promise<void>((res) => { a.onended = () => res(); a.onpause = () => res() })
}
export const stopRecordingPlayback = () => current?.pause()

export function wav16k(pcm: Int16Array, rate = 16000): Blob {
  const n = pcm.length
  const b = new DataView(new ArrayBuffer(44))
  const str = (o: number, t: string) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, rate, true)
  b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, n * 2, true)
  return new Blob([b, pcm], { type: 'audio/wav' })
}

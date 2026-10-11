// 口语流利度的客观指标（不靠 AI）：说了多久、停顿几次、最长停多久、每分钟多少词
// 能量门限做语音活动检测：每 20ms 一帧，比本段最响的 10% 帧安静很多就算静音

export type Fluency = { speakSec: number; totalSec: number; pauses: number; longestPause: number; wpm: number | null; words: number }

export function fluency(audio: Float32Array, transcript: string, sr = 16000): Fluency {
  const hop = Math.round(sr * 0.02)
  const rms: number[] = []
  for (let s = 0; s + hop <= audio.length; s += hop) {
    let e = 0
    for (let i = s; i < s + hop; i++) e += audio[i] * audio[i]
    rms.push(Math.sqrt(e / hop))
  }
  const sorted = [...rms].sort((a, b) => a - b)
  const loud = sorted[Math.floor(sorted.length * 0.9)] ?? 0
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0
  const th = Math.max(floor * 2, loud * 0.12, 0.003)
  const voiced = rms.map((r) => r > th)
  // 首尾的静音不算（开口前、说完后）
  const first = voiced.indexOf(true), last = voiced.lastIndexOf(true)
  const words = (transcript.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length
  if (first < 0) return { speakSec: 0, totalSec: audio.length / sr, pauses: 0, longestPause: 0, wpm: null, words }
  let pauses = 0, longest = 0, run = 0
  for (let i = first; i <= last; i++) {
    if (!voiced[i]) { run++; continue }
    if (run * 0.02 >= 0.5) { pauses++; longest = Math.max(longest, run * 0.02) }
    run = 0
  }
  const speakSec = (last - first + 1) * 0.02
  return { speakSec: +speakSec.toFixed(1), totalSec: +(audio.length / sr).toFixed(1), pauses, longestPause: +longest.toFixed(1), wpm: speakSec >= 3 ? Math.round(words / (speakSec / 60)) : null, words }
}

/** 一句话描述（给用户看，也给 AI 当参考） */
export function fluencyNote(f: Fluency): string {
  if (!f.wpm) return '说得太短，看不出流利度'
  const speed = f.wpm < 80 ? '偏慢' : f.wpm > 170 ? '偏快' : '适中'
  return `每分钟约 ${f.wpm} 词（${speed}），停顿 ${f.pauses} 次${f.longestPause >= 2 ? `，最长停了 ${f.longestPause} 秒` : ''}`
}

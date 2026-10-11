import { describe, expect, it } from 'vitest'
import { fluency } from '../fluency'

// 造一段“说话”：有声段是 200Hz 正弦，静音段是很轻的噪声
const clip = (segs: [boolean, number][]) => {
  const parts = segs.map(([v, sec]) => Float32Array.from({ length: Math.round(sec * 16000) }, (_, i) => (v ? 0.4 * Math.sin((2 * Math.PI * 200 * i) / 16000) : (Math.random() - 0.5) * 0.002)))
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

describe('流利度', () => {
  it('首尾静音不算，中间 ≥0.5 秒的才算停顿', () => {
    const f = fluency(clip([[false, 1], [true, 3], [false, 0.8], [true, 2], [false, 0.2], [true, 1], [false, 2.5], [true, 2], [false, 1]]), 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty')
    expect(f.pauses).toBe(2)
    expect(f.longestPause).toBeCloseTo(2.5, 1)
    expect(f.speakSec).toBeCloseTo(11.5, 0)
    expect(f.wpm).toBeGreaterThan(90)
    expect(f.wpm).toBeLessThan(115)
  })
  it('全是静音', () => expect(fluency(clip([[false, 2]]), '').wpm).toBeNull())
})

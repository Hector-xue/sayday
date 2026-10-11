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

import { segments } from '../fluency'
describe('长回答切段', () => {
  it('短的不切；长的在静音处切、每段不超过上限', () => {
    expect(segments(clip([[true, 8]]))).toHaveLength(1)
    const a = clip([[true, 12], [false, 1], [true, 12], [false, 0.6], [true, 10]])
    const s = segments(a, 20)
    expect(s.length).toBe(3)
    for (const [x, y] of s) expect((y - x) / 16000).toBeLessThanOrEqual(20.01)
    // 第一刀应落在第一段静音里（12~13 秒）
    expect(s[0][1] / 16000).toBeGreaterThan(12)
    expect(s[0][1] / 16000).toBeLessThan(13)
  })
})

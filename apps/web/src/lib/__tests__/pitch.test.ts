import { describe, expect, it } from 'vitest'
import { advice, compare, contour, yin } from '../pitch'

const tone = (f: (t: number) => number, sec = 1, sr = 16000) => {
  const x = new Float32Array(sr * sec); let ph = 0
  for (let i = 0; i < x.length; i++) { ph += (2 * Math.PI * f(i / sr)) / sr; x[i] = 0.5 * Math.sin(ph) + 0.2 * Math.sin(2 * ph) }
  return x
}

describe('语调', () => {
  it('YIN 测得出固定音高', () => {
    const f0 = yin(tone(() => 200)).filter((v): v is number => v !== null)
    expect(f0.length).toBeGreaterThan(50)
    expect(Math.abs(f0[30] - 200)).toBeLessThan(4)
  })
  it('句尾升调 / 降调分得出来，形状一样相似度高', () => {
    const up = contour(yin(tone((t) => 150 + 80 * t)))
    const down = contour(yin(tone((t) => 230 - 80 * t)))
    const upHigh = contour(yin(tone((t) => 220 + 110 * t))) // 女声，同样上扬
    const c1 = compare(up, upHigh)
    expect(c1.sim!).toBeGreaterThan(0.9)
    expect(c1.endRef).toBe('up')
    const c2 = compare(down, up)
    expect(c2.sim!).toBeLessThan(0)
    expect(advice(c2)[0]).toContain('句尾示范是下降')
  })
  it('静音不出曲线', () => expect(contour(yin(new Float32Array(16000)))).toEqual([]))
})

import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ kvGet: vi.fn(async (_k: string, d: unknown) => d), kvSet: vi.fn() }))
import { hit, newTally, summary, verdict } from '../feedback'

describe('连对和结算', () => {
  it('连对每满 5 题换成连对的音，答错清零但最长连对保留', () => {
    const t = newTally()
    const s = [true, true, true, true, true, true, false, true].map((ok) => hit(t, ok))
    expect(s).toEqual(['right', 'right', 'right', 'right', 'combo', 'right', 'wrong', 'right'])
    expect(t).toMatchObject({ right: 7, wrong: 1, combo: 1, best: 6 })
  })
  it('结算数字：正确率四舍五入，没题可判时为空；跟读平均和最好', () => {
    const t = newTally()
    for (const ok of [true, true, false]) hit(t, ok)
    t.shadow.push(70, 91)
    expect(summary(t, 125)).toMatchObject({ minutes: 2, accuracy: 67, graded: 3, best: 2, shadowAvg: 81, shadowBest: 91 })
    expect(summary(newTally(), 20)).toMatchObject({ minutes: 1, accuracy: null, shadowAvg: null })
  })
  it('一句话按成绩说', () => {
    const all = newTally(); for (let i = 0; i < 6; i++) hit(all, true)
    expect(verdict(summary(all, 60))).toBe('全对，一题没错')
    const low = newTally(); hit(low, true); hit(low, false); hit(low, false)
    expect(verdict(summary(low, 60))).toContain('有点难')
    expect(verdict(summary(newTally(), 60))).toBe('这一组完成了')
  })
})

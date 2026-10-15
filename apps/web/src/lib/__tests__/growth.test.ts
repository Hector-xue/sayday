import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: vi.fn(), kvSet: vi.fn(), today: () => '2026-10-15' }))
import { ABILITIES, overallBand, type Ctx } from '../growth'

describe('雅思总分取整', () => {
  it('官方规则：.25 进 .5，.75 进整数，.125 舍', () => {
    expect(overallBand([6.5, 6.5, 5, 7])).toBe(6.5) // 6.25
    expect(overallBand([6.5, 6.5, 6, 8])).toBe(7) // 6.75
    expect(overallBand([6, 6, 6, 6.5])).toBe(6) // 6.125
    expect(overallBand([4, 5, 6, 7])).toBe(5.5)
  })
})

describe('能力解锁', () => {
  const base: Ctx = { vocab: 0, listen: null, readBand: null, mock: false, diaries: 0, chats: 0, recentScore: null, attempts: 0, seasonsDone: [] }
  const ok = (c: Partial<Ctx>) => ABILITIES.filter((a) => a.ok({ ...base, ...c })).map((a) => a.id)
  it('新人什么都没有', () => expect(ok({})).toEqual([]))
  it('按数据解锁', () => {
    expect(ok({ vocab: 3200 })).toEqual(['travel', 'daily90'])
    expect(ok({ listen: 'B1' })).toEqual(['bbc6'])
    expect(ok({ listen: 'B2', vocab: 5200 })).toContain('show')
    expect(ok({ attempts: 25, recentScore: 82 })).toEqual(['clear'])
    expect(ok({ attempts: 10, recentScore: 90 })).toEqual([])
    expect(ok({ seasonsDone: [1, 4] })).toEqual(['london', 'nyc'])
  })
})

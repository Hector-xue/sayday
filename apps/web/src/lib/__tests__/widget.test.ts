import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: async () => null, kvSet: async () => {}, today: () => '2026-10-12' }))
vi.mock('../lesson', () => ({ dayRow: async () => null }))
vi.mock('../content', () => ({ loadContent: async () => ({ byWord: new Map() }) }))
import { streakOf } from '../widget'

const on = (...d: string[]) => d.map((date) => ({ date, active: true }))
describe('连续天数', () => {
  it('今天练了：从今天往前数', () => expect(streakOf(on('2026-10-12', '2026-10-11', '2026-10-10', '2026-10-08'), '2026-10-12')).toBe(3))
  it('今天还没练：从昨天往前数，不算断', () => expect(streakOf(on('2026-10-11', '2026-10-10'), '2026-10-12')).toBe(2))
  it('昨天也没练：0', () => expect(streakOf(on('2026-10-10'), '2026-10-12')).toBe(0))
  it('跨月', () => expect(streakOf(on('2026-11-01', '2026-10-31', '2026-10-30'), '2026-11-01')).toBe(3))
  it('有记录但没活动的天不算', () => expect(streakOf([{ date: '2026-10-12', active: false }, ...on('2026-10-11')], '2026-10-12')).toBe(1))
})

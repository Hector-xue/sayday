import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: vi.fn(), kvSet: vi.fn(), today: () => '2026-10-15' }))
import { awayFrom, weekOf, weekStart } from '../rhythm'

const on = (...d: string[]) => new Set(d)

describe('周目标', () => {
  it('周一算一周开头', () => {
    expect(weekStart('2026-10-15')).toBe('2026-10-12') // 周四
    expect(weekStart('2026-10-12')).toBe('2026-10-12')
    expect(weekStart('2026-10-18')).toBe('2026-10-12') // 周日
  })
  it('本周亮灯天数，断一天不清零', () => {
    const w = weekOf(on('2026-10-12', '2026-10-14', '2026-10-15'), '2026-10-15')
    expect(w.lit).toBe(3); expect(w.met).toBe(false); expect(w.days.map((d) => d.lit)).toEqual([true, false, true, true, false, false, false])
  })
  it('连续达标周：从上周往前数，本周达标也算', () => {
    const last = ['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-11']
    const before = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']
    expect(weekOf(on(...last, ...before), '2026-10-15').streak).toBe(2)
    expect(weekOf(on(...last, ...before, '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'), '2026-10-15')).toMatchObject({ met: true, streak: 3 })
    // 上周只练了 3 天：断了
    expect(weekOf(on(...last.slice(1), ...before), '2026-10-15').streak).toBe(0)
  })
  it('跨月跨年', () => {
    expect(weekStart('2027-01-01')).toBe('2026-12-28')
  })
})

describe('离开天数', () => {
  it('上次练习到今天隔几天，今天练的不算', () => {
    expect(awayFrom(on('2026-10-01', '2026-10-05', '2026-10-15'), '2026-10-15')).toBe(10)
    expect(awayFrom(on(), '2026-10-15')).toBeNull()
  })
})

describe('积压拆分', () => {
  it('留 perDay 个在今天，其余每天 perDay 个往后推，同一天只摊一次', async () => {
    const m = await import('../db') as any
    m.db.all = vi.fn(async () => Array.from({ length: 25 }, (_, i) => ({ word: 'w' + i })))
    const ops: any[] = []
    m.db.batch = vi.fn(async (o: any[]) => { ops.push(...o) })
    m.kvGet.mockResolvedValueOnce('')
    const { spreadBacklog } = await import('../rhythm')
    const now = new Date('2026-10-15T10:00:00').getTime()
    expect(await spreadBacklog(10, now)).toBe(15)
    const days = ops.map((o) => new Date(o.params[0]).getDate())
    expect(days.filter((d) => d === 16).length).toBe(10)
    expect(days.filter((d) => d === 17).length).toBe(5)
    expect(new Date(ops[0].params[0]).getHours()).toBe(6)
    m.kvGet.mockResolvedValueOnce('2026-10-15')
    expect(await spreadBacklog(10, now)).toBe(0)
  })
})

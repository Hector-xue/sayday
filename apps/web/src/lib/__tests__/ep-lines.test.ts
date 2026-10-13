import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: async () => null, kvSet: async () => {}, today: (d = new Date('2026-10-13T12:00:00')) => d.toISOString().slice(0, 10) }))
import { dueLineCards, enqueueLines, gradeLine, type LineCard } from '../episodes'

const D = '2026-10-13'
describe('剧集台词复习', () => {
  it('演完：低于 80 分和跳过的进队，读好的不进；明天到期', () => {
    const l = enqueueLines([], 1, 2, [0, 2, 4], { 0: 92, 2: 61 }, D)
    expect(l.map((c) => c.i)).toEqual([2, 4])
    expect(l.every((c) => c.due === '2026-10-14' && c.box === 0)).toBe(true)
    expect(dueLineCards(l, D)).toEqual([])
    expect(dueLineCards(l, '2026-10-14').length).toBe(2)
  })
  it('同一集重演：已在队里的重新从头排，不重复', () => {
    let l = enqueueLines([], 1, 2, [2], {}, D)
    l = gradeLine(l, { s: 1, e: 2, i: 2 }, 90, '2026-10-14')
    l = enqueueLines(l, 1, 2, [2], { 2: 50 }, '2026-10-15')
    expect(l).toEqual([{ s: 1, e: 2, i: 2, box: 0, due: '2026-10-16' }])
  })
  it('读好往后推 3→7→14 天，读完四轮移出；没读好回到明天', () => {
    const r = { s: 1, e: 2, i: 2 }
    let l: LineCard[] = enqueueLines([], 1, 2, [2], {}, D)
    l = gradeLine(l, r, 85, D); expect(l[0]).toMatchObject({ box: 1, due: '2026-10-16' })
    l = gradeLine(l, r, 70, D); expect(l[0]).toMatchObject({ box: 0, due: '2026-10-14' })
    for (const _ of [1, 2, 3]) l = gradeLine(l, r, 90, D)
    expect(l[0]).toMatchObject({ box: 3, due: '2026-10-27' })
    expect(gradeLine(l, r, 90, D)).toEqual([])
  })
  it('队列最多 60 句，满了丢最早的', () => {
    let l: LineCard[] = []
    for (let e = 1; e <= 13; e++) l = enqueueLines(l, 1, e, [0, 1, 2, 3, 4], {}, D)
    expect(l.length).toBe(60)
    expect(l[0]).toMatchObject({ e: 2, i: 0 })
  })
})

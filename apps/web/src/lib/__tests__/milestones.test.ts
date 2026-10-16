import { beforeEach, describe, expect, it, vi } from 'vitest'
const kv = new Map<string, unknown>()
vi.mock('../db', () => ({ db: {}, kvGet: vi.fn(async (k: string, d: unknown) => (kv.has(k) ? kv.get(k) : d)), kvSet: vi.fn(async (k: string, v: unknown) => { kv.set(k, v) }), today: () => '2026-10-16' }))
import { nextMilestone, pick, reached, type Ctx } from '../milestones'

const ctx = (x: Partial<Ctx>): Ctx => ({ days: 0, words: 0, shadows: 0, weeks: 0, best: 0, ...x })

describe('里程碑', () => {
  beforeEach(() => kv.clear())
  it('按档位算达成：每类从小到大，跟读 90 分只有一个', () => {
    expect(reached(ctx({ days: 8, best: 93 })).map((m) => m.id)).toEqual(['days-3', 'days-7', 'score-90'])
    expect(reached(ctx({ words: 120 })).map((m) => m.title)).toEqual(['在学的词到 50 个', '在学的词到 100 个'])
  })
  it('一次只弹一个：同类取最高档', () => {
    expect(pick(reached(ctx({ words: 320, shadows: 60 })))?.id).toBe('words-300')
  })
  it('老用户第一次：已达成的全记为看过，不弹', async () => {
    expect(await nextMilestone(ctx({ days: 40, words: 600 }))).toBeNull()
    expect(kv.get('milestones_seen')).toContain('days-30')
    // 之后新达成的才弹，弹过不再弹
    expect((await nextMilestone(ctx({ days: 50, words: 600 })))?.id).toBe('days-50')
    expect(await nextMilestone(ctx({ days: 50, words: 600 }))).toBeNull()
  })
  it('新用户：从零开始，到第 3 天弹', async () => {
    expect(await nextMilestone(ctx({ days: 1 }))).toBeNull()
    expect((await nextMilestone(ctx({ days: 3 })))?.title).toBe('练了 3 天')
  })
})

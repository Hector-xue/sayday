import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: async () => null, kvSet: async () => {}, today: () => '2026-10-12' }))
import { bandsFromVocab, buildCheck, computeVocab, frontierOf, listenLevelFrom, mergeCheck, shownLevel, type VocabState } from '../calibrate'
import { listenOptions } from '../lesson'
import { BANDS, type Answer } from '../placement'
import type { Word } from '../content'
import type { Sentence } from '../content'

const zero = BANDS.map(() => 0)
const st = (bands: number[], extra: Partial<VocabState> = {}): VocabState => ({ bands, ts: 0, source: 'placement', lowStreak: 0, shown: 'A2', ...extra })

describe('词汇量计算', () => {
  it('手动选档：按词频从常用往后填满，总数对得上', () => {
    const b = bandsFromVocab(2500)
    expect(b.slice(0, 3)).toEqual([1, 1, 1])
    expect(b[3]).toBeCloseTo(0.5)
    expect(computeVocab(b, zero, 0)).toBe(2500)
  })
  it('学会一个词精确 +1，不和定级重复计数', () => {
    const b = bandsFromVocab(2500)
    const per = [...zero]; per[3] = 10 // 第 4 档学了 10 个词（定级认为这档认识一半）
    // 这 10 个从“按五成估”的部分拿出来，按学会算：2500 - 10*0.5 + 10
    expect(computeVocab(b, per, 10)).toBe(2505)
  })
  it('学新词的起点 = 第一个认识不到八成的档', () => {
    expect(frontierOf([1, 0.9, 0.7, 0.2, 0, 0, 0, 0])).toBe(BANDS[2][0])
    expect(frontierOf(BANDS.map(() => 1))).toBe(12000)
  })
})

const ans = (band: number, real: boolean, yes: boolean): Answer => ({ item: { text: 'x', real, band }, yes, ms: 500 })

describe('每周小测', () => {
  it('只改测到的档，新旧各一半', () => {
    const s0 = st([1, 1, 0.6, 0.2, 0, 0, 0, 0])
    const a = [...Array(5)].map(() => ans(2, true, true)).concat([...Array(5)].map(() => ans(3, true, false)), [ans(-1, false, false), ans(-1, false, false), ans(-1, false, false)])
    const s1 = mergeCheck(s0, a, 123)
    expect(s1.bands[0]).toBe(1)
    expect(s1.bands[2]).toBeGreaterThan(0.6)
    expect(s1.bands[3]).toBeLessThan(0.2)
    expect(s1.ts).toBe(123)
    expect(s1.source).toBe('weekly')
  })
  it('乱点“认识”（假词也认识）时，修正后不会虚高', () => {
    const s0 = st([1, 1, 0.5, 0.2, 0, 0, 0, 0])
    const a = [...Array(5)].map(() => ans(2, true, true)).concat([ans(-1, false, true), ans(-1, false, true), ans(-1, false, true)])
    const s1 = mergeCheck(s0, a, 9)
    expect(s1.bands).toBe(s0.bands)
    expect(s1.ts).toBe(9)
  })
  it('抽题：边界附近三档、跳过已有词卡和敏感词、混 3 个假词', () => {
    const words: Word[] = []
    for (let r = 1; r <= 12000; r += 7) words.push({ w: 'w' + r, rank: r, cefr: 'B1', ipa: '', zh: '', tags: [], cmu: [], sensitive: r === 1002 })
    const items = buildCheck([1, 1, 0.5, 0.1, 0, 0, 0, 0], words, ['blick', 'florp', 'snerk', 'gwemp'], new Set(['w1009']))
    expect(items.filter((i) => !i.real)).toHaveLength(3)
    expect(new Set(items.filter((i) => i.real).map((i) => i.band))).toEqual(new Set([1, 2, 3]))
    expect(items.some((i) => i.text === 'w1009' || i.text === 'w1002')).toBe(false)
  })
})

describe('降档护栏', () => {
  it('估出来更高马上显示', () => expect(shownLevel(st(zero, { shown: 'A2' }), 'B1')).toBe('B1'))
  it('一次偏低不降', () => expect(shownLevel(st(zero, { shown: 'B1', lowStreak: 1 }), 'A2')).toBe('B1'))
  it('连续两次偏低才降', () => expect(shownLevel(st(zero, { shown: 'B1', lowStreak: 2 }), 'A2')).toBe('A2'))
})

describe('听力水平', () => {
  const rows = (cefr: string, n: number, ok: number) => [...Array(n)].map((_, i) => ({ cefr, ok: i < ok ? 1 : 0 }))
  it('题太少不下结论', () => expect(listenLevelFrom(rows('A2', 5, 5)).cefr).toBeNull())
  it('取最高的“至少 6 题且七成对”的档', () => {
    expect(listenLevelFrom([...rows('A1', 6, 6), ...rows('A2', 8, 6), ...rows('B1', 6, 3)]).cefr).toBe('A2')
  })
  it('选项：正确答案在里面、干扰项同档且不重复', () => {
    const mk = (id: number, en: string, zh: string, cefr = 'A2'): Sentence => ({ id, en, zh, hard: 100, cefr, words: [] })
    const s = mk(1, 'I want to go home now.', '我现在想回家。')
    const pool = [s, mk(2, 'She likes green tea a lot.', '她很喜欢绿茶。'), mk(3, 'We met at the station.', '我们在车站见了面。'), mk(4, 'This one is very hard.', '这个很难。', 'C1')]
    const r = listenOptions(s, pool, () => 0.3)
    expect(r.options[r.answer]).toBe(s.zh)
    expect(r.options).toHaveLength(3)
    expect(r.options).not.toContain('这个很难。')
  })
})

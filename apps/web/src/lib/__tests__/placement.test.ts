import { describe, expect, it } from 'vitest'
import { BANDS, buildItems, manualPlacement, scorePlacement, shouldStop, type Answer, type Item } from '../placement'
import { cefrFromVocab, eta, vocabFloor, cefrFromIelts } from '../levels'
import type { Word } from '../content'

const words: Word[] = Array.from({ length: 12000 }, (_, i) => ({ w: `w${i + 1}x`, rank: i + 1, cefr: 'A1', ipa: '', zh: '', tags: [], cmu: ['AH'], sensitive: false }))
const pseudo = Array.from({ length: 40 }, (_, i) => `fake${i}`)

/** 模拟一个学习者：认识排名 ≤ knowUpTo 的词；fakeYes 比例的假词也点“认识” */
function simulate(knowUpTo: number, fakeYes = 0): Answer[] {
  const bands = buildItems(words, pseudo, new Set(), 42)
  const out: Answer[] = []
  let k = 0
  for (const band of bands) {
    for (const item of band) {
      const yes = item.real ? Number(item.text.slice(1, -1)) <= knowUpTo : k++ % 10 < fakeYes * 10
      out.push({ item, yes, ms: 800 })
    }
    if (shouldStop(out)) break
  }
  return out
}

describe('定级', () => {
  it('每档 7 真词 + 2 假词', () => {
    const b = buildItems(words, pseudo, new Set(), 1)
    expect(b).toHaveLength(BANDS.length)
    for (const band of b) {
      expect(band.filter((x: Item) => x.real)).toHaveLength(7)
      expect(band.filter((x: Item) => !x.real)).toHaveLength(2)
    }
  })
  it('认识前 2000 词、不乱认 → 约 2000 词、A2，并提前结束', () => {
    const a = simulate(2000)
    const r = scorePlacement(a)
    expect(r.vocab).toBeGreaterThan(1700)
    expect(r.vocab).toBeLessThan(2300)
    expect(r.cefr).toBe('A2')
    expect(r.frontier).toBe(2001)
    expect(a.length).toBeLessThan(8 * 9) // 后面几档没测
  })
  it('乱认假词的人分数被拉低', () => {
    const honest = scorePlacement(simulate(5000)).vocab
    const liar = scorePlacement(simulate(5000, 0.5)).vocab
    expect(liar).toBeLessThan(honest)
  })
  it('全都不认识 → Pre-A1，从第 1 个词开始学', () => {
    const r = scorePlacement(simulate(0))
    expect(r.cefr).toBe('Pre-A1')
    expect(r.frontier).toBe(1)
  })
  it('手动选档', () => {
    expect(manualPlacement('B1').cefr).toBe('B1')
  })
})

describe('刻度', () => {
  it('词汇量 → CEFR 边界', () => {
    expect(cefrFromVocab(0)).toBe('Pre-A1')
    expect(cefrFromVocab(1499)).toBe('A1')
    expect(cefrFromVocab(1500)).toBe('A2')
    expect(cefrFromVocab(9000)).toBe('C2')
    expect(vocabFloor('B1')).toBe(2500)
  })
  it('雅思对照', () => {
    expect(cefrFromIelts(7)).toBe('C1')
    expect(cefrFromIelts(6.5)).toBe('B2')
    expect(cefrFromIelts(5)).toBe('B1')
  })
  it('预计时长按剩余学时、分钟数越多越快', () => {
    const a = eta('A2', 'C1', 20)
    const b = eta('A2', 'C1', 45)
    expect(a.hoursLeft).toBe(560)
    expect(b.days).toBeLessThan(a.days)
    expect(eta('C1', 'B2', 20).hoursLeft).toBe(0)
    expect(eta('B1', 'C1', 20, 'A2').progress).toBeCloseTo((560 - 375) / 560, 2)
  })
})

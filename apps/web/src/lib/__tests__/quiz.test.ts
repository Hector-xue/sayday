import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: vi.fn(), kvSet: vi.fn(), today: () => '2026-10-15' }))
import { makeQuestions, quizTimes, shortZh } from '../quiz'
import type { Word } from '../content'

const W = (w: string, rank: number, zh: string): Word => ({ w, rank, cefr: 'A2', ipa: '', zh, tags: '', cmu: [], sensitive: false } as unknown as Word)
const words = [W('easy', 501, 'a. 容易的, 缓缓的；adv. 容易地'), W('apple', 520, 'n. 苹果'), W('chair', 530, 'n. 椅子'), W('table', 540, 'n. 桌子'), W('river', 560, 'n. 河流'), W('happy', 570, 'a. 快乐的')]
const byWord = new Map(words.map((w) => [w.w, w]))

describe('通知里做题', () => {
  it('释义取前两个、去词性、放得进按钮', () => {
    expect(shortZh(words[0])).toBe('容易的，缓缓的')
    expect(shortZh(words[1])).toBe('苹果')
  })
  it('生词出 3 选 1，熟词出拼写；答案在选项里，选项不重复', () => {
    const qs = makeQuestions([{ word: 'apple', reps: 0 }, { word: 'river', reps: 3 }], byWord, words, 10, () => 0.3)
    expect(qs[0]).toMatchObject({ kind: 'choice', word: 'apple', answer: '苹果' })
    expect(qs[0].options).toHaveLength(3)
    expect(qs[0].options).toContain('苹果')
    expect(new Set(qs[0].options).size).toBe(3)
    expect(qs[1]).toMatchObject({ kind: 'spell', answer: 'river', prompt: '拼出这个词：河流' })
  })
  it('出题时间：接下来 7 天，过了的跳过', () => {
    const now = new Date(2026, 9, 15, 13, 0)
    const t = quizTimes({ on: true, hour: 12, minute: 30 }, now)
    expect(t).toHaveLength(6)
    expect(new Date(t[0]).getDate()).toBe(16)
    expect(quizTimes({ on: true, hour: 20, minute: 0 }, now)).toHaveLength(7)
  })
})

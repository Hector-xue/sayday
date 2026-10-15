import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: vi.fn(), kvSet: vi.fn(), today: () => '2026-10-15' }))
import { preferTopics, topicMatcher, TOPICS } from '../interests'

const S = (id: number, words: string[]) => ({ id, en: '', zh: '', hard: 0, cefr: 'A2', words })

describe('兴趣话题', () => {
  it('没选兴趣：不偏，和以前一样', () => {
    expect(topicMatcher([])).toBeNull()
    const pool = [S(1, ['cat'])]
    expect(preferTopics(pool, null)).toBe(pool)
  })
  it('按句子里的词判断话题', () => {
    const m = topicMatcher(['food'])!
    expect(m(S(1, ['cook', 'dinner']))).toBe(true)
    expect(m(S(2, ['computer']))).toBe(false)
  })
  it('七成从话题句里挑，话题句太少就不偏', () => {
    const m = topicMatcher(['food'])
    const pool = [...Array.from({ length: 12 }, (_, i) => S(i, ['cook'])), ...Array.from({ length: 30 }, (_, i) => S(100 + i, ['car']))]
    expect(preferTopics(pool, m, () => 0.1)).toHaveLength(12)
    expect(preferTopics(pool, m, () => 0.9)).toHaveLength(42)
    expect(preferTopics(pool.slice(5), m, () => 0.1)).toHaveLength(37)
  })
  it('每个话题至少 15 个词，id 不重复', () => {
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length)
    for (const t of TOPICS) expect(t.words.length).toBeGreaterThanOrEqual(15)
  })
})

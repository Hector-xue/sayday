import { describe, expect, it } from 'vitest'
import { bookOrder } from '../books'
import type { Word } from '../content'

const w = (word: string, rank: number, tags: string[]): Word => ({ w: word, rank, cefr: 'B1', ipa: '', zh: '', tags, cmu: ['X'], sensitive: false })

describe('词书', () => {
  const words = [w('a', 100, ['ielts']), w('b', 900, []), w('c', 1000, ['ielts']), w('d', 1500, ['cet4']), w('e', 2000, ['ielts']), w('f', 2100, [])]
  it('先学水平附近往上的书内词，再补前面的，最后是书外的', () => {
    expect(bookOrder(words, 'ielts', 1000).map((x) => x.w)).toEqual(['c', 'e', 'a', 'd', 'f'])
  })
  it('书外的词只接水平以上的', () => {
    expect(bookOrder(words, 'gre', 1000).map((x) => x.w)).toEqual(['c', 'd', 'e', 'f'])
  })
})

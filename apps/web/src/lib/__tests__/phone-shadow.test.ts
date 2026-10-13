import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: async () => null, kvSet: async () => {}, today: () => '2026-10-13' }))
import { phoneOfDay, phoneShadow } from '../lesson'
import { rankLabel, type Sentence, type Word } from '../content'

const w = (word: string, cmu: string, rank = 100): Word => ({ w: word, rank, cefr: 'A1', ipa: '', zh: '', tags: [], cmu: cmu.split(' '), sensitive: false })
const s = (id: number, en: string, words: string[], hard = 500): Sentence => ({ id, en, zh: '', hard, cefr: 'A1', words })
const byWord = new Map([w('think', 'TH IH NG K'), w('three', 'TH R IY'), w('thank', 'TH AE NG K'), w('cat', 'K AE T'), w('dog', 'D AO G')].map((x) => [x.w, x]))

describe('弱项跟读', () => {
  const sents = [
    s(1, 'I think the cat likes the dog.', ['think', 'cat', 'dog']),
    s(2, 'Thank you, I think three is fine.', ['thank', 'think', 'three']),
    s(3, 'Three cats think about thanks a lot.', ['three', 'cat', 'think', 'thank'], 9000),
  ]
  it('挑含这个音最多、且在水平以内的句子，高亮第一个含它的词', () => {
    const r = phoneShadow('TH', sents, byWord, 1500, new Set(), () => 0)
    expect(r?.sentence.id).toBe(2)
    expect(r?.focus).toBe('Thank')
  })
  it('有含两个的就不挑只含一个的；都凑不出两个时含一个也行；用过的不再挑', () => {
    expect(phoneShadow('TH', sents, byWord, 1500, new Set([2]))?.sentence.id).toBe(1)
    expect(phoneShadow('D', sents, byWord, 1500, new Set())?.sentence.id).toBe(1)
    expect(phoneShadow('TH', sents, byWord, 1500, new Set([1, 2]))).toBeUndefined()
  })
  it('高亮按词形还原找词（thinking → think）', () => {
    const r = phoneShadow('TH', [s(4, "I'm thinking about three things.", ['think', 'three', 'thing'])], byWord, 1500, new Set())
    expect(r?.focus).toBe('thinking')
  })
  it('前三个弱项按天轮换', () => {
    expect(phoneOfDay([])).toBeUndefined()
    const days = ['2026-10-13', '2026-10-14', '2026-10-15'].map((d) => phoneOfDay(['TH', 'V', 'R'], d))
    expect(new Set(days).size).toBe(3)
  })
})

describe('词表排名标签', () => {
  it('1.2 万以内显示常用排名，之后是大纲补充词', () => {
    expect(rankLabel(w('x', '', 3500))).toBe('第 3,500 常用')
    expect(rankLabel(w('y', '', 12001))).toBe('大纲补充词')
  })
})

import { describe, expect, it } from 'vitest'
import { lookup, type Word } from '../content'

const mk = (w: string): Word => ({ w, rank: 1, cefr: 'A1', ipa: '', zh: w + '的意思', tags: [], cmu: [], sensitive: false })
const byWord = new Map(['study', 'make', 'run', 'big', 'happy', 'quick', 'go', 'i', 'will', 'can', 'do', 'box', 'love'].map((w) => [w, mk(w)]))

describe('点词查义', () => {
  it.each([
    ['Studies', 'study'], ['studied', 'study'], ['making', 'make'], ['running', 'run'], ['bigger', 'big'], ['biggest', 'big'],
    ['quickly', 'quick'], ["I'm", 'i'], ["won't", 'will'], ["can't", 'can'], ["doesn't", 'do'], ['boxes', 'box'], ['loved', 'love'], ['goes', 'go'], ['happier', 'happy'], ['happiest', 'happy'],
  ])('%s → %s', (t, w) => { expect(lookup(byWord, t)?.w).toBe(w) })
  it('查不到返回 undefined', () => { expect(lookup(byWord, 'xyzzy')).toBeUndefined() })
})

import { describe, expect, it } from 'vitest'
import { canSpell, diffLetters, judgeSpell } from '../spell'

describe('拼写', () => {
  it('判对错：大小写和空格不算错；长词错一个字母算差一点', () => {
    expect(judgeSpell('river', ' River ')).toBe('right')
    expect(judgeSpell('volunteer', 'voluntear')).toBe('close')
    expect(judgeSpell('river', 'rivr')).toBe('wrong')
    expect(judgeSpell('volunteer', 'volantear')).toBe('wrong')
  })
  it('逐字标出：写错、漏写、多写', () => {
    expect(diffLetters('river', 'rivr').map((m) => m.k)).toEqual(['ok', 'ok', 'ok', 'missing', 'ok'])
    expect(diffLetters('cat', 'cut').map((m) => `${m.c}:${m.k}`)).toEqual(['c:ok', 'a:wrong', 't:ok'])
    expect(diffLetters('cat', 'catt').filter((m) => m.k === 'extra')).toHaveLength(1)
  })
  it('哪些词出拼写', () => {
    expect(canSpell('river')).toBe(true)
    expect(canSpell("don't")).toBe(false)
    expect(canSpell('ox')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { contraction } from '../contractions'

describe('contraction', () => {
  it('否定缩写给展开和意思', () => {
    expect(contraction("doesn't")).toEqual({ full: 'does not', zh: '不（否定，主语是他/她/它）' })
    expect(contraction("Won't")?.full).toBe('will not')
    expect(contraction('can’t')?.full).toBe('cannot')
  })
  it('代词缩写', () => {
    expect(contraction("I'm")?.full).toBe('i am')
    expect(contraction("they'll")?.full).toBe('they will')
    expect(contraction("it's")?.full).toBe('it is / it has')
  })
  it('名词所有格和普通词不算缩写', () => {
    expect(contraction("key's")).toBeUndefined()
    expect(contraction('work')).toBeUndefined()
  })
})

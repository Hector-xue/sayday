import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: async () => null, kvSet: async () => {}, today: () => '2026-10-12' }))
import { cleanName, clipOf, personalize, PRESET_NAMES, type Season } from '../episodes'
import { readFileSync } from 'node:fs'

const raw = (n: number): Season => JSON.parse(readFileSync(new URL(`../../../../../content/episodes/s${n}.json`, import.meta.url), 'utf8'))

describe('剧里的你', () => {
  it('名字只收英文字母，首字母大写', () => {
    expect(cleanName('  amy ')).toBe('Amy')
    expect(cleanName('Mary Jane')).toBe('Mary Jane')
    expect(cleanName('小明')).toBeNull()
    expect(cleanName('')).toBeNull()
    expect(cleanName('a'.repeat(17))).toBeNull()
  })

  it('换名字：英文、中文、题目都换，内部字段和“都柏林”不动', () => {
    for (const n of [1, 2, 3, 4]) {
      const s = personalize(raw(n), { name: 'Amy', voice: 'f' })
      const text = JSON.stringify(s.episodes)
      expect(text).not.toMatch(/\bLin\b(?!")/) // 只剩 "who":"Lin"
      expect(s.episodes.flatMap((e) => e.lines).filter((l) => l.who === 'Lin').length).toBeGreaterThan(0)
      expect(s.cast.Lin.zh).toBe('Amy（你）')
      for (const e of s.episodes) for (const l of e.lines) expect(l.zh).not.toMatch(/(?<!柏)林/)
      if (n === 2) expect(text).toContain('都柏林')
    }
  })

  it('默认 Lin 原样不变', () => {
    const r = raw(1)
    const s = personalize(r, { name: 'Lin', voice: 'f' })
    expect(s.episodes[0].lines[1].en).toBe(r.episodes[0].lines[1].en)
    expect(s.cast.Lin.zh).toBe(r.cast.Lin.zh)
  })

  it('配音键：男声、预配名字、列表外名字走系统朗读', () => {
    const s = personalize(raw(1), { name: 'Amy', voice: 'm' })
    const l0 = s.episodes[0].lines[0] // Lin 的台词，没提名字
    const l1 = s.episodes[0].lines[1] // Emma：you must be Lin
    expect(clipOf(1, 1, 0, l0, { name: 'Amy', voice: 'm' }, true).ep).toBe('s1e1-0.m')
    expect(clipOf(1, 1, 0, l0, { name: 'Amy', voice: 'f' }, true).ep).toBe('s1e1-0')
    expect(clipOf(1, 1, 1, l1, { name: 'Amy', voice: 'm' }, false).ep).toBe('s1e1-1.n-amy')
    expect(clipOf(1, 1, 1, l1, { name: 'Amy', voice: 'm' }, false).text).toContain('Amy')
    const z = personalize(raw(1), { name: 'Zed', voice: 'f' })
    expect(clipOf(1, 1, 1, z.episodes[0].lines[1], { name: 'Zed', voice: 'f' }, false).ep).toBeUndefined()
    const d = personalize(raw(1), { name: 'Lin', voice: 'f' })
    expect(clipOf(1, 1, 1, d.episodes[0].lines[1], { name: 'Lin', voice: 'f' }, false).ep).toBe('s1e1-1')
  })

  it('预配名字不和任何角色重名', () => {
    const cast = new Set([1, 2, 3, 4].flatMap((n) => Object.keys(raw(n).cast)))
    for (const n of PRESET_NAMES) expect(cast.has(n)).toBe(false)
  })
})

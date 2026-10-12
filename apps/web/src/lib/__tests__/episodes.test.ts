import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
vi.mock('../db', () => ({ db: {}, kvGet: async () => null, kvSet: async () => {}, today: () => '2026-10-12' }))
import { nextUp, unlocked, key, teaserFor, type Season } from '../episodes'
import { dictWord, tokenize } from '../speech/score'

const root = new URL('../../../../../', import.meta.url).pathname
const all: Season[] = [1, 2, 3, 4].map((n) => JSON.parse(readFileSync(root + `content/episodes/s${n}.json`, 'utf8')))
const dict: Record<string, string> = JSON.parse(readFileSync(root + 'packages/speech/cmudict.min.json', 'utf8'))

describe('剧集内容', () => {
  it('结构完整：每季 10 集、角色都在演员表里、题目答案下标合法、每集林都有台词', () => {
    for (const s of all) expect(s.episodes).toHaveLength(10)
    for (const s of all) for (const e of s.episodes) {
      for (const l of e.lines) { expect(s.cast[l.who], `${e.id} ${l.who}`).toBeTruthy(); expect(l.zh.length).toBeGreaterThan(1) }
      for (const q of e.quiz) expect(q.answer).toBeLessThan(q.options.length)
      expect(e.lines.some((l) => l.who === 'Lin')).toBe(true)
    }
  })
  it('林的台词基本都能打分（发音词典里查得到，人名地名除外）', () => {
    const names = new Set(['lin', 'emma', 'tom', 'patel', 'sophie', 'arthur', 'hangzhou', 'camden', 'edinburgh', 'manchester', 'hiya', 'callum', 'morag', 'mackenzie', 'jake', 'ceilidh', 'priya', 'reed', 'hale', 'ana', 'alvarez', 'brooks'])
    const miss = new Set<string>()
    for (const s of all) for (const e of s.episodes) for (const l of e.lines) if (l.who === 'Lin') for (const w of tokenize(l.en)) if (!dictWord(dict, w) && !names.has(w)) miss.add(w)
    expect([...miss]).toEqual([])
  })
})

describe('一天解锁一集（跨季）', () => {
  const p = (done: Record<string, string>) => ({ done: Object.fromEntries(Object.entries(done).map(([k, d]) => [k, { date: d, quiz: 3, act: null }])) })
  it('第一季第一集随时能看', () => expect(unlocked(all, 1, 1, p({}))).toBe(true))
  it('上一集今天才看完：下一集明天解锁', () => {
    expect(unlocked(all, 1, 2, p({ [key(1, 1)]: '2026-10-12' }), '2026-10-12')).toBe(false)
    expect(unlocked(all, 1, 2, p({ [key(1, 1)]: '2026-10-12' }), '2026-10-13')).toBe(true)
    expect(nextUp(all, p({ [key(1, 1)]: '2026-10-12' })).state).toBe('tomorrow')
  })
  it('第一季看完第二天解锁第二季第一集，预告接上', () => {
    const s1done = Object.fromEntries(all[0].episodes.map((e) => [key(1, e.id), '2026-10-01']))
    const u = nextUp(all, p(s1done))
    expect(u.season.season).toBe(2)
    expect(u.ep.id).toBe(1)
    expect(u.state).toBe('ready')
    expect(teaserFor(all, 2, 1)).toContain('第二季')
  })
  it('全看完', () => {
    const done = Object.fromEntries(all.flatMap((s) => s.episodes.map((e) => [key(s.season, e.id), '2026-01-01'])))
    expect(nextUp(all, p(done)).state).toBe('all-done')
  })
})

describe('英式拼写', () => {
  it('能找到美式写法', () => {
    expect(dictWord(dict, 'practising')).toBe('practicing')
    expect(dictWord(dict, 'colour')).toBeTruthy()
    expect(dictWord(dict, 'centre')).toBeTruthy()
    expect(dictWord(dict, 'organised')).toBeTruthy()
    expect(dictWord(dict, 'travelled')).toBeTruthy()
    expect(tokenize('A café near the canal')).toEqual(['a', 'cafe', 'near', 'the', 'canal'])
  })
})

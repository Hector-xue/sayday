import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
vi.mock('../db', () => ({ db: {}, kvGet: async () => null, kvSet: async () => {}, today: () => '2026-10-12' }))
import { band, correct, grade, norm, type Group, type ListeningTest, type ReadingTest } from '../practice'

const root = new URL('../../../../../', import.meta.url).pathname
const reading: ReadingTest[] = JSON.parse(readFileSync(root + 'content/ielts/reading.json', 'utf8')).tests
const listening: ListeningTest[] = JSON.parse(readFileSync(root + 'content/ielts/listening.json', 'utf8')).tests
const voices = new Set(['af_heart', 'af_nicole', 'af_bella', 'af_sarah', 'am_michael', 'am_adam', 'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily', 'bm_george', 'bm_lewis', 'bm_daniel', 'bm_fable'])
const flat = (s: string) => s.replace(/\s+/g, ' ')

/** 每组题的通用检查：题号连续、答案合法、依据在原文里、填空答案原文里有且不超词数 */
function checkGroups(groups: Group[], source: string, from: number) {
  let n = from
  for (const g of groups) for (const it of g.items) {
    expect(it.n, `题号 ${n}`).toBe(n++)
    expect(flat(source), `第 ${it.n} 题依据不在原文里：${it.at}`).toContain(flat(it.at))
    expect(it.why.length, `第 ${it.n} 题没有解析`).toBeGreaterThan(4)
    if (g.type === 'tfng') expect(['T', 'F', 'NG']).toContain(it.a)
    if (g.type === 'ynng') expect(['Y', 'N', 'NG']).toContain(it.a)
    if (g.type === 'mc') { expect(it.options!.length).toBeGreaterThanOrEqual(3); expect(it.a).toBeLessThan(it.options!.length) }
    if (g.type === 'pick') expect(it.a).toBeLessThan(g.options!.length)
    if (g.type === 'gap') {
      const a = it.a as string[]
      expect(it.q).toContain('___')
      // 第一个标准答案必须在依据里原样出现，并且符合词数限制
      const d = (x: string) => x.replace(/[\s-]/g, '')
      if (/^[\d\s.:-]+$/.test(a[0])) expect(d(it.at), `第 ${it.n} 题答案不在依据里`).toContain(d(a[0]))
      else expect(norm(it.at), `第 ${it.n} 题答案不在依据里`).toContain(norm(a[0]))
      for (const x of a) if (!/\d/.test(x)) expect(norm(x).split(' ').length, `第 ${it.n} 题答案超词数`).toBeLessThanOrEqual(g.limit! + (g.number ? 1 : 0))
      expect(correct(g, it, a[0])).toBe(true)
    }
  }
  return n
}

describe('雅思阅读题', () => {
  it('每套 3 篇 40 题，依据和答案都对得上原文', () => {
    for (const t of reading) {
      expect(t.passages).toHaveLength(3)
      let n = 1
      for (const p of t.passages) {
        n = checkGroups(p.groups, p.paras.join(' '), n)
        if (p.lettered) for (const g of p.groups.filter((g) => g.type === 'pick' && g.items[0].q.startsWith('Paragraph'))) expect(g.items.length).toBe(p.paras.length)
        const words = p.paras.join(' ').split(/\s+/).length
        expect(words, `${p.title} 篇幅`).toBeGreaterThan(550)
      }
      expect(n - 1).toBe(40)
    }
  })
})

describe('雅思听力题', () => {
  it('每套 4 部分 40 题，答案都在录音原文里，说话人都有声音', () => {
    for (const t of listening) {
      expect(t.parts).toHaveLength(4)
      let n = 1
      for (const p of t.parts) {
        for (const l of p.lines) { expect(p.cast[l.who], `${p.n} ${l.who}`).toBeTruthy(); expect(voices.has(p.cast[l.who].voice), p.cast[l.who].voice).toBe(true) }
        n = checkGroups(p.groups, p.lines.map((l) => l.en).join(' '), n)
      }
      expect(n - 1).toBe(40)
    }
  })
  it('朗读写法（say）和显示文字里的数字一致：显示的数字在朗读里换成了英文', () => {
    for (const t of listening) for (const p of t.parts) for (const l of p.lines) if (l.say) expect(/\d/.test(l.say), l.say).toBe(false)
  })
})

describe('判分', () => {
  const gap: Group = { type: 'gap', limit: 1, number: true, instr: '', instr_zh: '', items: [] }
  const it1 = { n: 1, q: '___', a: ['07946381552'], at: '', why: '' }
  const it2 = { n: 2, q: '___', a: ['7.15', '7:15'], at: '', why: '' }
  const it3 = { n: 3, q: '___', a: ['Garden'], at: '', why: '' }
  it('填空：大小写、首尾标点、空格不算错，拼错算错，超词数算错', () => {
    expect(correct(gap, it3, ' garden. ')).toBe(true)
    expect(correct(gap, it3, 'Gardin')).toBe(false)
    expect(correct(gap, it3, 'the garden room')).toBe(false)
    expect(correct(gap, it1, '07946 381 552')).toBe(true)
    expect(correct(gap, it2, '7:15')).toBe(true)
    expect(correct(gap, it2, '')).toBe(false)
  })
  it('选择 / 判断按下标或字母比', () => {
    const g: Group = { type: 'tfng', instr: '', instr_zh: '', items: [{ n: 1, q: '', a: 'NG', at: '', why: '' }, { n: 2, q: '', a: 'T', at: '', why: '' }] }
    expect(grade([g], { 1: 'NG', 2: 'F' })).toEqual({ right: 1, total: 2, marks: { 1: true, 2: false } })
  })
  it('分数换算：阅读 30/40 = 7，听力 32/40 = 7.5，单篇按比例', () => {
    expect(band('reading', 30)).toBe(7)
    expect(band('reading', 29)).toBe(6.5)
    expect(band('listening', 32)).toBe(7.5)
    expect(band('listening', 10, 10)).toBe(9)
    expect(band('reading', 10, 13)).toBe(7)
    expect(band('reading', 0)).toBe(0)
  })
})

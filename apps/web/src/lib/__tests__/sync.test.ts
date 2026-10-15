import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: vi.fn(), kvSet: vi.fn(), today: () => '2026-10-15' }))
import { deriveKeys, newCode, normCode, open, seal, validCode } from '../sync'

describe('同步码', () => {
  it('26 个字符、4 个一组，不含容易看错的字母', () => {
    const c = newCode()
    expect(c).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/)
    expect(validCode(c)).toBe(true)
    expect(newCode()).not.toBe(c)
  })
  it('输入宽容：小写、空格、O/I/L 都认', () => {
    const c = newCode(() => new Uint8Array(16).fill(7))
    expect(validCode(c.toLowerCase().replace(/-/g, ' '))).toBe(true)
    expect(normCode('o1-il')).toBe('0111')
    expect(validCode('ABC')).toBe(false)
  })
  it('同一个码在不同设备上算出同一个账号和密钥；个人同步和小组分开', async () => {
    const c = newCode()
    const a = await deriveKeys(c), b = await deriveKeys(c.toLowerCase())
    expect(a.id).toBe(b.id)
    expect(a.id).toMatch(/^[a-f0-9]{40}$/)
    expect((await deriveKeys(c, 'group')).id).not.toBe(a.id)
  })
  it('加密后能解开，换个码解不开；服务器拿到的是密文', async () => {
    const k1 = await deriveKeys(newCode()), k2 = await deriveKeys(newCode())
    const obj = { tables: { card: [{ word: 'apple' }] }, note: '你好' }
    const blob = await seal(obj, k1.key)
    expect(new TextDecoder().decode(blob)).not.toContain('apple')
    expect(await open(blob, k1.key)).toEqual(obj)
    await expect(open(blob, k2.key)).rejects.toThrow()
  })
})

describe('合并别的设备的快照', () => {
  it('流水并集去重、词卡新的为准、每天取大、设置按时间、剧集进度合并', async () => {
    const m = await import('../db') as any
    const local: Record<string, any[]> = {
      review_log: [{ id: 1, word: 'apple', rating: 3, state: 2, ts: 100, ms: null }],
      card: [{ word: 'apple', last_review: 100, reps: 1, added: 50 }, { word: 'pear', last_review: 500, reps: 4, added: 60 }],
      phoneme_stat: [], day: [{ date: '2026-10-14', reviews: 5, new_words: 0, shadows: 1, seconds: 60, minimum: 0, done: 0, listens: 0 }],
      kv: [{ key: 'interests', value: '["food"]' }, { key: 'ep_progress', value: JSON.stringify({ done: { '1:1': { date: '2026-10-10', quiz: 2, act: 70 } } }) }, { key: 'reminder', value: '{"on":true}' }],
      kv_ts: [{ key: 'interests', ts: 1000 }],
    }
    m.db.all = vi.fn(async (sql: string) => { const t = sql.match(/FROM (\w+)/)![1]; return local[t] ?? [] })
    const ops: any[] = []
    m.db.batch = vi.fn(async (o: any[]) => { ops.push(...o) })
    const { mergeSnapshot } = await import('../sync')
    const n = await mergeSnapshot({
      v: 1, dev: 'x', ts: 0,
      tables: {
        review_log: [{ id: 9, word: 'apple', rating: 3, state: 2, ts: 100, ms: null }, { id: 10, word: 'apple', rating: 1, state: 2, ts: 200, ms: null }],
        card: [{ word: 'apple', last_review: 200, reps: 2, added: 40 }, { word: 'pear', last_review: 300, reps: 9, added: 60 }, { word: 'kiwi', last_review: null, reps: 0, added: 70 }],
        day: [{ date: '2026-10-14', reviews: 3, new_words: 8, shadows: 0, seconds: 30, minimum: 0, done: 1, listens: 0 }],
      },
      kv: {
        interests: { v: '["travel"]', ts: 2000 },
        ep_progress: { v: JSON.stringify({ done: { '1:1': { date: '2026-10-09', quiz: 3, act: null }, '1:2': { date: '2026-10-11', quiz: 1, act: null } } }), ts: 1 },
        reminder: { v: '{"on":false}', ts: 9999 },
      },
    })
    const sqls = ops.map((o) => o.sql)
    // 复习记录：ts 100 那条已有，只插 ts 200 的，且不带远端的 id
    const rl = ops.filter((o) => o.sql.startsWith('INSERT INTO review_log'))
    expect(rl).toHaveLength(1); expect(rl[0].params).toContain(200); expect(rl[0].sql).not.toContain('id,')
    // apple 远端复习得更近 → 换成远端的，added 取早的；pear 本地更近 → 不动；kiwi 新词 → 插入
    const cardIns = ops.filter((o) => o.sql.startsWith('INSERT INTO card'))
    expect(cardIns.map((o) => o.params[0])).toEqual(['apple', 'kiwi'])
    expect(cardIns[0].params).toContain(40)
    expect(sqls.filter((s) => s.startsWith('DELETE FROM card'))).toHaveLength(1)
    // 每天：只把更大的列更新上去
    const day = ops.find((o) => o.sql.startsWith('UPDATE day'))
    expect(day.sql).toContain('new_words = ?'); expect(day.sql).toContain('done = ?'); expect(day.sql).not.toContain('reviews = ?')
    // 设置：远端更新 → 覆盖；本机专用的 reminder 不动；剧集进度两边合并
    const kv = ops.filter((o) => o.sql.startsWith('INSERT INTO kv(')).map((o) => [o.params[0], o.params[1]])
    expect(kv.find(([k]) => k === 'interests')![1]).toBe('["travel"]')
    expect(kv.some(([k]) => k === 'reminder')).toBe(false)
    const ep = JSON.parse(kv.find(([k]) => k === 'ep_progress')![1]).done
    expect(ep['1:1']).toMatchObject({ date: '2026-10-09', quiz: 3, act: 70 })
    expect(ep['1:2']).toBeTruthy()
    expect(n).toBe(ops.length)
  })
})

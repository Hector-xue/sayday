import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: vi.fn(), kvSet: vi.fn(), today: () => '2026-10-15' }))
import { deriveKeys, newCode, open, seal } from '../sync'
import * as bot from '../../../../../packages/bot/crypto.mjs'

describe('App 和聊天机器人的加密一致', () => {
  it('同一个同步码算出同一个账号，互相能解开对方的数据', async () => {
    const code = newCode()
    const a = await deriveKeys(code), b = await bot.deriveKeys(code)
    expect(b.id).toBe(a.id)
    const x = { tables: { review_log: [{ word: 'apple', ts: 1 }] } }
    expect(await bot.open(await seal(x, a.key), b.key)).toEqual(x)
    expect(await open(await bot.seal(x, b.key), a.key)).toEqual(x)
  })
})

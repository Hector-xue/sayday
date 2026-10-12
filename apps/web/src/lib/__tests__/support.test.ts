import { describe, expect, it, vi } from 'vitest'
const store = new Map<string, unknown>()
vi.mock('../db', () => ({ db: {}, kvGet: async (k: string, f: unknown) => store.get(k) ?? f, kvSet: async (k: string, v: unknown) => { store.set(k, v) }, today: () => '2026-10-13' }))
import { getSupport, markSupporter, shouldPrompt, snoozeSupport, SUPPORT } from '../support'
import { readFileSync } from 'node:fs'

describe('支持日日说', () => {
  it('练满门槛天数才提醒；支持过就永远不提', () => {
    expect(shouldPrompt({}, SUPPORT.minDays - 1)).toBe(false)
    expect(shouldPrompt({}, SUPPORT.minDays)).toBe(true)
    expect(shouldPrompt({ since: '2026-10-01' }, 999)).toBe(false)
  })

  it('“以后再说”期间不提，过期后再提', () => {
    const now = Date.parse('2026-10-13T12:00:00Z')
    const s = { snoozeUntil: now + SUPPORT.snoozeDays * 86400_000 }
    expect(shouldPrompt(s, 30, now)).toBe(false)
    expect(shouldPrompt(s, 30, s.snoozeUntil)).toBe(true)
  })

  it('状态存进 kv：先以后再说，再支持', async () => {
    store.clear()
    const a = await snoozeSupport(1000)
    expect(a.snoozeUntil).toBe(1000 + SUPPORT.snoozeDays * 86400_000)
    const b = await markSupporter()
    expect(b).toEqual({ snoozeUntil: a.snoozeUntil, since: '2026-10-13' })
    expect(await getSupport()).toEqual(b)
  })

  it('收款码图片在、尺寸和码内容的长度对得上（换码要一起重画）', () => {
    const svg = readFileSync(new URL('../../../public/support/wechat.svg', import.meta.url), 'utf8')
    expect(svg).toMatch(/^<svg/)
    // 53 字节、纠错 M → 版本 4（33×33）+ 两边各 2 格留白 = 37
    expect(svg).toContain('viewBox="0 0 37 37"')
    expect(SUPPORT.wechatQr).toHaveLength(53)
  })
})

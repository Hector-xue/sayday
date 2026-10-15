import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: vi.fn(async (_k: string, d: unknown) => d), kvSet: vi.fn(), today: () => '2026-10-15' }))
const merged: { s: any; preferRemote: boolean }[] = []
vi.mock('../sync', async (orig) => ({
  ...(await orig<typeof import('../sync')>()),
  deviceId: async () => 'dev-x',
  snapshot: async (dev: string) => ({ v: 1, dev, ts: 1, tables: { card: [{ word: 'mine' }] }, kv: {} }),
  mergeSnapshot: vi.fn(async (s: any, preferRemote = false) => { merged.push({ s, preferRemote }); return s.tables.card?.length ?? 0 }),
}))
import { joinHost, newPairCode, pairKeys, parseManual, parseSessionText, pollHost, rankAddrs, sessionText, showAddr, startHost, validPair, LAN_PORT } from '../lan'

describe('配对码和二维码内容', () => {
  it('10 位、4-4-2 分组，输入宽容', () => {
    const c = newPairCode()
    expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/)
    expect(validPair(c.toLowerCase().replace(/-/g, ' '))).toBe(true)
    expect(validPair('ABC')).toBe(false)
  })
  it('二维码内容来回一致；乱的不认', () => {
    const s = { addrs: ['192.168.1.5', '10.0.0.2'], port: 50123, code: 'ABCD-EFGH-JK' }
    expect(parseSessionText(sessionText(s))).toEqual({ ...s, code: 'ABCDEFGHJK' })
    expect(parseSessionText('https://example.com')).toBeNull()
    expect(parseSessionText('SAYDAY1;999.1.1.1;1;ABCDEFGHJK')).toBeNull()
  })
  it('手动输入：默认端口可以不写，中文冒号句号也认', () => {
    expect(parseManual('192.168.1.5', 'abcd efgh jk')).toEqual({ addrs: ['192.168.1.5'], port: LAN_PORT, code: 'ABCDEFGHJK' })
    expect(parseManual('192。168。1。5：50123', 'ABCDEFGHJK')?.port).toBe(50123)
    expect(parseManual('192.168.1', 'ABCDEFGHJK')).toBeNull()
    expect(showAddr({ addrs: ['1.2.3.4'], port: LAN_PORT, code: '' })).toBe('1.2.3.4')
  })
  it('局域网地址排前面，去重，去掉本机回环', () => {
    expect(rankAddrs(['100.64.1.2', '192.168.1.5', '127.0.0.1', '192.168.1.5', '10.0.0.3'])).toEqual(['192.168.1.5', '10.0.0.3', '100.64.1.2'])
  })
  it('同一个码两边算出同一把钥匙和 tag，换码就不同', async () => {
    const a = await pairKeys('ABCD-EFGH-JK'), b = await pairKeys('abcdefghjk'), c = await pairKeys('ABCD-EFGH-JM')
    expect(a.tag).toBe(b.tag); expect(a.tag).toMatch(/^[0-9a-f]{32}$/); expect(c.tag).not.toBe(a.tag)
  })
})

describe('一来一回交换（假的原生收发）', () => {
  afterEach(() => { delete (globalThis as any).__TAURI_INTERNALS__; merged.length = 0 })
  // 模拟 src/lan.rs：出码时记下内容和 tag；连过来的 tag 对就交换
  function fakeNative() {
    let host: { payload: string; tag: string } | null = null, got: string | null = null
    ;(globalThis as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a: any) => {
        if (cmd === 'lan_host') { host = { payload: a.payload, tag: a.tag }; return [LAN_PORT, ['192.168.1.5']] }
        if (cmd === 'plugin:sayday-infer|lan_addrs') return { addrs: ['192.168.43.1'] }
        if (cmd === 'lan_poll') { const g = got; got = null; return g }
        if (cmd === 'lan_stop') { host = null; return null }
        if (cmd === 'lan_send') {
          if (!host) throw '连不上 192.168.1.5:47231：Connection refused'
          if (a.tag !== host.tag) throw '配对码不对'
          got = a.payload; return host.payload
        }
        throw new Error('未知命令 ' + cmd)
      },
    }
  }
  it('两边各合到对方的快照；新设备不交出自己的', async () => {
    fakeNative()
    const { session, keys } = await startHost()
    expect(session.addrs).toEqual(['192.168.43.1', '192.168.1.5'])
    expect(await pollHost(keys)).toBeNull()
    const r = await joinHost(parseSessionText(sessionText(session))!, true)
    expect(r.changed).toBe(1)
    expect(merged[0]).toMatchObject({ preferRemote: true, s: { tables: { card: [{ word: 'mine' }] } } })
    const h = await pollHost(keys)
    expect(h).toEqual({ changed: 0 })
    expect(merged[1].s.tables).toEqual({}) // 新设备交出的是空快照
    expect(merged[1].preferRemote).toBe(false)
  })
  it('配对码不对、连不上：说人话', async () => {
    fakeNative()
    const { session } = await startHost()
    await expect(joinHost({ ...session, code: 'ZZZZZZZZZZ' })).rejects.toThrow('配对码不对')
    await (globalThis as any).__TAURI_INTERNALS__.invoke('lan_stop')
    await expect(joinHost(session)).rejects.toThrow(/同一个 Wi-Fi/)
  })
  it('网页版：直接说用 App', async () => {
    await expect(startHost()).rejects.toThrow(/App/)
  })
})

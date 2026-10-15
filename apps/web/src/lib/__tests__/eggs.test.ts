import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
vi.mock('../db', () => ({ db: {}, kvGet: vi.fn(), kvSet: vi.fn(), today: () => '2026-10-15' }))
import { EGG_KIND, nextEgg, type Egg } from '../eggs'
import { CITIES } from '../citymap'

const root = new URL('../../../../../', import.meta.url).pathname
const eggs: Egg[] = JSON.parse(readFileSync(root + 'content/eggs/eggs.json', 'utf8')).eggs

describe('每日彩蛋', () => {
  it('内容：id 不重复、类型合法、中英和说明都有', () => {
    expect(new Set(eggs.map((e) => e.id)).size).toBe(eggs.length)
    for (const e of eggs) { expect(EGG_KIND[e.kind]).toBeTruthy(); expect(e.en && e.zh && e.note_zh).toBeTruthy() }
  })
  it('今天开过就还是那个；没开过的按顺序轮，不重复', () => {
    const first = nextEgg(eggs, {}, '2026-10-15')!
    expect(nextEgg(eggs, { '2026-10-15': first.id }, '2026-10-15')!.id).toBe(first.id)
    const second = nextEgg(eggs, { '2026-10-15': first.id }, '2026-10-16')!
    expect(second.id).not.toBe(first.id)
  })
  it('全开完从头再来', () => {
    const all = Object.fromEntries(eggs.map((e, i) => [`2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`, e.id]))
    expect(nextEgg(eggs, all, '2027-01-01')).toBeTruthy()
  })
})

describe('城市地图', () => {
  it('四季各 10 个地方，对上剧集', () => {
    expect(CITIES.map((c) => c.season)).toEqual([1, 2, 3, 4])
    for (const c of CITIES) expect(c.places).toHaveLength(10)
  })
})

import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: vi.fn(), kvSet: vi.fn(), today: () => '2026-10-15' }))
import { NUDGE_LINES, PERSONAS, systemPrompt } from '../companion'

describe('Emma 性格', () => {
  it('默认温柔：语气和纠错门槛和以前一样', () => {
    const p = systemPrompt('B1', [], [])
    expect(p).toContain('warm and natural')
    expect(p).toContain('Set "fix" ONLY when')
  })
  it('毒舌：开玩笑但不嘲笑英语水平', () => {
    const p = systemPrompt('B1', [], [], 'tease')
    expect(p).toContain('cheeky')
    expect(p).toContain('Never mock their English level')
  })
  it('考官：每个错都纠、追问', () => {
    const p = systemPrompt('B1', [], [], 'strict')
    expect(p).toContain('follow-up questions')
    expect(p).toContain('Set "fix" whenever')
  })
  it('每种性格都有提醒文案，中英都有', () => {
    for (const { k } of PERSONAS) {
      expect(NUDGE_LINES[k].length).toBeGreaterThanOrEqual(4)
      for (const l of NUDGE_LINES[k]) expect(l).toMatch(/[A-Za-z].*（.+）$/)
    }
  })
})

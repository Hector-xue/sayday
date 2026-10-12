import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { predict } from '../../../../../packages/speech/calib.mjs'

// 打分校准表：曾被误清成空文件，而其他测试全绿。这里守住它的结构和数值范围
const root = new URL('../../../../../', import.meta.url).pathname
const calib = JSON.parse(readFileSync(root + 'packages/speech/calib.json', 'utf8'))

describe('打分校准表 calib.json', () => {
  it('音素校准：有树、阈值、42 个音素的特征', () => {
    expect(calib.trees.length).toBeGreaterThan(20)
    expect(calib.thresholds).toEqual({ red: 0.8, yellow: 1.4 })
    expect(calib.features).toEqual(['af(clip -20..0)', 'utt_mean_af', 'phone_onehot[42]'])
  })
  it('整句模型：7 个特征的线性权重', () => {
    expect(calib.utt.coef).toHaveLength(7)
    expect(calib.utt.features).toHaveLength(7)
    expect(Number.isFinite(calib.utt.intercept)).toBe(true)
  })
  it('读得好的音分数高、读得差的分数低（0~2 分制）', () => {
    const x = (af: number, mean: number, phone: number) => [af, mean, ...Array.from({ length: 42 }, (_, i) => (i === phone ? 1 : 0))]
    const good = predict(calib, x(-0.2, -0.5, 5))
    const bad = predict(calib, x(-15, -6, 5))
    expect(good).toBeGreaterThan(1.4)
    expect(bad).toBeLessThan(1.0)
    expect(good).toBeLessThanOrEqual(2.2)
  })
})

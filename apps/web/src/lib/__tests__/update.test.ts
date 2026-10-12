import { describe, expect, it } from 'vitest'
import { cmpVersion, parseNotes } from '../update'

describe('应用内更新', () => {
  it('按数字比较版本号', () => {
    expect(cmpVersion('0.0.10', '0.0.9')).toBeGreaterThan(0)
    expect(cmpVersion('0.1.0', '0.0.99')).toBeGreaterThan(0)
    expect(cmpVersion('0.0.9', '0.0.9')).toBe(0)
    expect(cmpVersion('0.0.8', '0.0.9')).toBeLessThan(0)
    expect(cmpVersion('1.0.0', '1.0.0-rc')).toBe(0)
  })

  it('发版说明取标题和要点，去掉加粗', () => {
    const md = '**新内容：雅思第三套**\n\n从旧版直接覆盖安装，学习记录都在。\n\n- 雅思第三套：阅读 3 篇\n- **剧集**第四季\n'
    expect(parseNotes(md)).toEqual({ title: '新内容：雅思第三套', points: ['雅思第三套：阅读 3 篇', '剧集第四季'] })
    expect(parseNotes('')).toEqual({ title: '', points: [] })
  })
})

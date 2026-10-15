// 浏览器插件划词收进来的词（方案 1.1）：插件作为一台同步设备，把词加进词卡，把你当时看到的原句存在 kv 'clips'。
// 复习、学这个词的时候把原句也显示出来——“在哪儿见过它”是最好的记忆线索
import { kvGet } from './db'

export type Clip = { s: string; url?: string; title?: string; ts: number }
export const getClips = () => kvGet<Record<string, Clip>>('clips', {})

/** 原句里把这个词（含变形）标出来：返回 [前, 词, 后]，找不到就整句放在前面 */
export function markWord(s: string, word: string): [string, string, string] {
  const m = s.match(new RegExp(`\\b(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-z']*)\\b`, 'i'))
  if (!m || m.index === undefined) return [s, '', '']
  return [s.slice(0, m.index), m[1], s.slice(m.index + m[1].length)]
}

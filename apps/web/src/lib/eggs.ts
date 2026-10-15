// 每日彩蛋（方案 1.7，可变奖励）：做完当天的练习开一个——习语、英美俚语、词源、绕口令、冷知识。
// 按固定的乱序轮着开，开过的不重复，全开完再从头来；开过的都收进“彩蛋收藏”
import { kvGet, kvSet, today } from './db'

export type Egg = { id: string; kind: 'idiom' | 'slang' | 'origin' | 'twister' | 'fact'; en: string; zh: string; note_zh: string }
export const EGG_KIND: Record<Egg['kind'], string> = { idiom: '习语', slang: '俚语', origin: '词源', twister: '绕口令', fact: '冷知识' }

let cache: Promise<Egg[]> | null = null
export const loadEggs = (): Promise<Egg[]> => (cache ??= fetch('./content/eggs.json').then((r) => r.json()).then((j) => j.eggs))

/** 开过的：日期 → 彩蛋 id */
export const getOpened = () => kvGet<Record<string, string>>('eggs_opened', {})

/** 固定乱序（每个人一样，按 id 算），这样相邻两天不会总是同一类 */
const order = (eggs: Egg[]) => [...eggs].sort((a, b) => hash(a.id) - hash(b.id))
function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

/** 下一个该开的：今天开过就还是那个；否则按顺序找没开过的，全开过就从头 */
export function nextEgg(eggs: Egg[], opened: Record<string, string>, date = today()): Egg | null {
  if (!eggs.length) return null
  if (opened[date]) return eggs.find((e) => e.id === opened[date]) ?? null
  const seen = new Set(Object.values(opened))
  const list = order(eggs)
  return list.find((e) => !seen.has(e.id)) ?? list[Object.keys(opened).length % list.length]
}

export async function todayEgg(): Promise<{ egg: Egg | null; opened: boolean }> {
  const [eggs, opened] = await Promise.all([loadEggs(), getOpened()])
  return { egg: nextEgg(eggs, opened), opened: !!opened[today()] }
}
export async function openEgg(id: string) {
  const o = await getOpened()
  if (!o[today()]) await kvSet('eggs_opened', { ...o, [today()]: id })
}
export async function collection(): Promise<{ date: string; egg: Egg }[]> {
  const [eggs, opened] = await Promise.all([loadEggs(), getOpened()])
  const by = new Map(eggs.map((e) => [e.id, e]))
  return Object.entries(opened).filter(([, id]) => by.has(id)).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, id]) => ({ date, egg: by.get(id)! }))
}

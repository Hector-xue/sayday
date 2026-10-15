// 学习搭子（方案 1.7）：几个人拉一个小组，只互相看“本周练了几天”，不排行、不比分数。
// 小组码和同步码一样是端到端加密的：服务器只存加密的小卡片（名字、本周亮灯天数、连续达标周数）
import { kvGet, kvSet } from './db'
import { API, deriveKeys, newCode, normCode, open, seal } from './sync'
import { currentWeek } from './rhythm'

export type Buddy = { code: string; name: string; member: string }
export type Card = { name: string; lit: number; goal: number; streak: number; week: string; ts: number }
export type Member = Card & { me: boolean; id: string }

export const getBuddy = () => kvGet<Buddy | null>('buddy', null)

async function memberId(group: string): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(16))
  return [...raw].map((x) => x.toString(16).padStart(2, '0')).join('') + group.slice(0, 8)
}

async function call(path: string, init?: RequestInit) {
  let r: Response
  try { r = await fetch(API + path, init) } catch { throw new Error('连不上服务，检查一下网络') }
  if (!r.ok) { let m = `服务出错（${r.status}）`; try { m = (await r.json()).error ?? m } catch { /* 不是 JSON */ } throw new Error(m) }
  return r
}

/** 建一个小组（create）或用小组码加入；名字是给组里其他人看的 */
export async function joinGroup(name: string, code?: string): Promise<Buddy> {
  const c = code ? normCode(code).match(/.{1,4}/g)!.join('-') : newCode()
  const { id } = await deriveKeys(c, 'group')
  const b: Buddy = { code: c, name: name.trim().slice(0, 16) || '我', member: await memberId(id) }
  await kvSet('buddy', b)
  await pushCard()
  return b
}

export async function leaveGroup() {
  const b = await getBuddy()
  if (b) { const { id } = await deriveKeys(b.code, 'group'); await call(`/v1/g/${id}/m/${b.member}`, { method: 'DELETE' }).catch(() => {}) }
  await kvSet('buddy', null)
}

/** 更新自己的小卡片（打开进步页、做完练习时） */
export async function pushCard() {
  const b = await getBuddy()
  if (!b) return
  const { id, key } = await deriveKeys(b.code, 'group')
  const w = await currentWeek()
  const card: Card = { name: b.name, lit: w.lit, goal: w.goal, streak: w.streak, week: w.days[0].date, ts: Date.now() }
  await call(`/v1/g/${id}/m/${b.member}`, { method: 'PUT', body: await seal(card, key) })
}

/** 组里所有人（解不开的、上周以前的卡片显示成“这周还没练”） */
export async function members(): Promise<Member[]> {
  const b = await getBuddy()
  if (!b) return []
  const { id, key } = await deriveKeys(b.code, 'group')
  const thisWeek = (await currentWeek()).days[0].date
  const { members: ms } = await (await call(`/v1/g/${id}`)).json() as { members: { id: string; data: string }[] }
  const out: Member[] = []
  for (const m of ms) {
    try {
      const c = await open<Card>(Uint8Array.from(atob(m.data), (ch) => ch.charCodeAt(0)), key)
      out.push({ ...c, lit: c.week === thisWeek ? c.lit : 0, me: m.id === b.member, id: m.id })
    } catch { /* 不是这个小组的数据 */ }
  }
  // 不排行：自己放第一个，其余按名字
  return out.sort((a, z) => (a.me ? -1 : z.me ? 1 : a.name.localeCompare(z.name, 'zh')))
}

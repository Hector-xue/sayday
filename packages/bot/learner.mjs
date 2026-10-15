// 一个绑定了同步码的学习者：从同步服务拉各设备的快照合成“现在的样子”（词卡取复习得最近的那份），
// 机器人里答的题按 FSRS 更新词卡、记复习记录，作为一台叫“机器人”的设备传回去——App 下次同步时合进来。
import { createEmptyCard, fsrs, generatorParameters, Rating } from 'ts-fsrs'
import { deriveKeys, open, seal } from './crypto.mjs'

// 和 App 一样的调度参数（apps/web/src/lib/srs.ts）
const scheduler = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 365, enable_fuzz: true, enable_short_term: true }))
export { Rating }

/** 按凌晨 4 点换日（和 App 一样）；tz 偏移分钟（北京时间 480） */
export function dayOf(ts, tzMin = 480) {
  const d = new Date(ts + tzMin * 60_000 - 4 * 3600_000)
  return d.toISOString().slice(0, 10)
}

export class Learner {
  /** state：持久化的部分（同步码、本设备 id、机器人自己产生的记录） */
  constructor(api, state) { this.api = api; this.s = state; this.view = null }

  async keys() { return (this._k ??= await deriveKeys(this.s.code)) }

  async req(path, init) {
    const r = await fetch(this.api + path, init)
    if (!r.ok) { let m = `同步服务出错（${r.status}）`; try { m = (await r.json()).error ?? m } catch {} throw new Error(m) }
    return r
  }

  /** 拉所有设备（除了自己）的快照，合成词卡 / 档案视图 */
  async pull() {
    const { id, key } = await this.keys()
    const { devices } = await (await this.req(`/v1/a/${id}`)).json()
    const cards = new Map(), kv = new Map()
    let profile = null, n = 0
    for (const d of devices) {
      if (d.dev === this.s.dev) continue
      const snap = await open(new Uint8Array(await (await this.req(`/v1/a/${id}/d/${d.dev}`)).arrayBuffer()), key)
      n++
      for (const c of snap.tables?.card ?? []) { const o = cards.get(c.word); if (!o || (c.last_review ?? 0) > (o.last_review ?? 0)) cards.set(c.word, c) }
      for (const [k, v] of Object.entries(snap.kv ?? {})) { const o = kv.get(k); if (!o || v.ts >= o.ts) kv.set(k, v) }
    }
    // 机器人自己答过的题更新过的词卡更新
    for (const c of Object.values(this.s.cards ?? {})) { const o = cards.get(c.word); if (!o || (c.last_review ?? 0) >= (o.last_review ?? 0)) cards.set(c.word, c) }
    if (kv.has('profile')) profile = JSON.parse(kv.get('profile').v)
    this.view = { cards, profile, devices: n }
    return this.view
  }

  /** 快到期的词（没“早就认识”的），最早到期的在前 */
  due(n = 30) {
    return [...(this.view?.cards.values() ?? [])].filter((c) => !c.known).sort((a, b) => a.due - b.due).slice(0, n)
  }

  /** 记一次作答：FSRS 更新词卡、写复习记录、累计当天复习数 */
  grade(word, ok, at = Date.now()) {
    const c = this.view?.cards.get(word)
    if (!c) return null
    const card = { due: new Date(c.due), stability: c.stability, difficulty: c.difficulty, elapsed_days: c.elapsed_days, scheduled_days: c.scheduled_days, learning_steps: c.learning_steps ?? 0, reps: c.reps, lapses: c.lapses, state: c.state, last_review: c.last_review ? new Date(c.last_review) : undefined }
    const rating = ok ? Rating.Good : Rating.Again
    const next = scheduler.next(card, new Date(at), rating).card
    const row = { ...c, due: next.due.getTime(), stability: next.stability, difficulty: next.difficulty, elapsed_days: next.elapsed_days, scheduled_days: next.scheduled_days, learning_steps: next.learning_steps, reps: next.reps, lapses: next.lapses, state: next.state, last_review: at }
    this.view.cards.set(word, row)
    this.s.cards = { ...(this.s.cards ?? {}), [word]: row }
    this.s.review_log = [...(this.s.review_log ?? []), { word, rating, state: c.state, ts: at, ms: null }].slice(-2000)
    const d = dayOf(at, this.s.tz ?? 480)
    const day = this.s.day?.[d] ?? { date: d, reviews: 0, new_words: 0, shadows: 0, seconds: 0, minimum: 0, done: 0, listens: 0 }
    this.s.day = { ...(this.s.day ?? {}), [d]: { ...day, reviews: day.reviews + 1 } }
    return row
  }
  /** 跟读一句也算当天练过 */
  shadow(at = Date.now()) {
    const d = dayOf(at, this.s.tz ?? 480)
    const day = this.s.day?.[d] ?? { date: d, reviews: 0, new_words: 0, shadows: 0, seconds: 0, minimum: 0, done: 0, listens: 0 }
    this.s.day = { ...(this.s.day ?? {}), [d]: { ...day, shadows: day.shadows + 1 } }
  }

  /** 把机器人这台“设备”的记录传上去（格式和 App 的快照一样，只含机器人产生的部分） */
  async push() {
    const { id, key } = await this.keys()
    const snap = { v: 1, dev: this.s.dev, ts: Date.now(), tables: { card: Object.values(this.s.cards ?? {}), review_log: this.s.review_log ?? [], day: Object.values(this.s.day ?? {}) }, kv: {} }
    await this.req(`/v1/a/${id}/d/${this.s.dev}`, { method: 'PUT', body: await seal(snap, key) })
  }

  async leave() {
    const { id } = await this.keys()
    await this.req(`/v1/a/${id}/d/${this.s.dev}`, { method: 'DELETE' }).catch(() => {})
  }
}

export { createEmptyCard }

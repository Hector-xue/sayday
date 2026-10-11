// 主线程这边的数据库客户端：所有 SQL 都在 Worker 里跑，这里只做消息往返
type Row = Record<string, any>
const worker = new Worker(new URL('./db-worker.ts', import.meta.url), { type: 'module' })
let seq = 0
const pending = new Map<number, { resolve: (r: Row[]) => void; reject: (e: Error) => void }>()
worker.onmessage = (e) => {
  const { id, rows, error } = e.data
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  if (error) p.reject(new Error(error))
  else p.resolve(rows)
}
function send(msg: object): Promise<Row[]> {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.postMessage({ id, ...msg })
  })
}

export const db = {
  all: <T = Row>(sql: string, params: unknown[] = []) => send({ sql, params }) as Promise<T[]>,
  one: async <T = Row>(sql: string, params: unknown[] = []) => ((await send({ sql, params })) as T[])[0] as T | undefined,
  run: (sql: string, params: unknown[] = []) => send({ sql, params }).then(() => undefined),
  /** 一个事务里依次执行，返回最后一条的结果 */
  batch: (items: { sql: string; params?: unknown[] }[]) => send({ batch: items }),
  info: async () => (await send({ info: true }))[0] as { mode: 'opfs' | 'local' | 'memory'; initErr: string | null },
}

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const r = await db.one<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key])
  return r ? (JSON.parse(r.value) as T) : fallback
}
export function kvSet(key: string, value: unknown) {
  return db.run('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)])
}

/** 本地日期 YYYY-MM-DD（按凌晨 4 点换日：熬夜学的算前一天） */
export function today(now = new Date()): string {
  const d = new Date(now.getTime() - 4 * 3600_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

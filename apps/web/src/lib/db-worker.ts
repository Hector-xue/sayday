// SQLite WASM Worker：优先 OPFS（opfs-sahpool，不需要 COOP/COEP，Safari / 安卓 WebView 可用），
// 不支持 OPFS 时退到 localStorage 后端（kvvfs，容量约 5MB，够一个人用很久），并在“设置”里说明。
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { MIGRATIONS } from './schema'

type Req = { id: number; sql: string; params?: unknown[]; batch?: { sql: string; params?: unknown[] }[] }

let db: any = null
let mode: 'opfs' | 'local' | 'memory' = 'memory'
let initErr: string | null = null

const ready = (async () => {
  const sqlite3: any = await sqlite3InitModule({ print: () => {}, printErr: () => {} })
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'sayday-pool' })
    db = new pool.OpfsSAHPoolDb('/sayday.db')
    mode = 'opfs'
  } catch (e) {
    initErr = String(e)
    try {
      db = new sqlite3.oo1.JsStorageDb('local')
      mode = 'local'
    } catch {
      db = new sqlite3.oo1.DB(':memory:')
      mode = 'memory'
    }
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)')
  const v = Number(db.selectValue("SELECT value FROM meta WHERE key='schema'") ?? 0)
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i])
      db.exec({ sql: "INSERT INTO meta(key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", bind: [String(i + 1)] })
    })
  }
})()

function run(sql: string, params?: unknown[]) {
  const rows: Record<string, unknown>[] = []
  db.exec({ sql, bind: params && params.length ? params : undefined, rowMode: 'object', resultRows: rows })
  return rows
}

self.onmessage = async (e: MessageEvent<Req | { id: number; info: true }>) => {
  const req = e.data
  try {
    await ready
    if ('info' in req) {
      self.postMessage({ id: req.id, rows: [{ mode, initErr }] })
      return
    }
    if (req.batch) {
      let out: Record<string, unknown>[] = []
      db.transaction(() => { for (const b of req.batch!) out = run(b.sql, b.params) })
      self.postMessage({ id: req.id, rows: out })
    } else {
      self.postMessage({ id: req.id, rows: run(req.sql, req.params) })
    }
  } catch (err) {
    self.postMessage({ id: req.id, error: String((err as Error)?.message || err) })
  }
}

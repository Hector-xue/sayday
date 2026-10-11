// SQLite WASM + OPFS（opfs-sahpool：不需要 COOP/COEP，Safari 也支持）
import sqlite3InitModule from '../node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3-bundler-friendly.mjs'

self.onmessage = async () => {
  try {
    const sqlite3 = await sqlite3InitModule()
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'sayday-pool' })
    const db = new pool.OpfsSAHPoolDb('/sayday.db')
    db.exec(`CREATE TABLE IF NOT EXISTS review_log(id INTEGER PRIMARY KEY, card_id INTEGER, rating INTEGER, ts INTEGER)`)
    const before = db.selectValue('SELECT count(*) FROM review_log')
    const t0 = performance.now()
    db.transaction(() => {
      const st = db.prepare('INSERT INTO review_log(card_id, rating, ts) VALUES (?,?,?)')
      for (let i = 0; i < 10000; i++) st.bind([i % 3000, 1 + (i % 4), Date.now()]).stepReset()
      st.finalize()
    })
    const insertMs = performance.now() - t0
    const t1 = performance.now()
    const due = db.selectValue('SELECT count(DISTINCT card_id) FROM review_log WHERE rating <= 2')
    const queryMs = performance.now() - t1
    const after = db.selectValue('SELECT count(*) FROM review_log')
    db.close()
    self.postMessage({ ok: true, before, after, insert10kMs: Math.round(insertMs), queryMs: +queryMs.toFixed(1), due })
  } catch (e) {
    self.postMessage({ ok: false, error: String(e && e.stack || e) })
  }
}

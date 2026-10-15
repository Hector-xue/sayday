// 导出 / 导入备份（JSON 文件）：换手机、重装、网页版换设备都靠它。录音存档（recording、voice_diary）是二进制、体积大，不放进来
import { db } from './db'
import { mergeSnapshot, type Snapshot } from './sync'

const TABLES = ['kv', 'card', 'review_log', 'attempt', 'phoneme_stat', 'day', 'level_estimate', 'listen_log', 'chat', 'diary', 'speaking_test', 'writing', 'practice', 'work']

/** 导出；返回给用户看的一句话 */
export async function exportBackup(): Promise<string> {
  const out: Record<string, unknown> = { app: 'sayday', exported: new Date().toISOString() }
  for (const t of TABLES) out[t] = await db.all(`SELECT * FROM ${t}`)
  const json = JSON.stringify(out)
  const name = `sayday-备份-${new Date().toISOString().slice(0, 10)}.json`
  const tauri = (globalThis as any).__TAURI__?.core
  if (tauri) {
    // App 里 WebView 不处理下载：交给原生插件写进系统“下载/Sayday”
    const u8 = new TextEncoder().encode(json)
    let bin = ''
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as unknown as number[])
    try { const r = await tauri.invoke('plugin:sayday-infer|save_to_downloads', { name, mime: 'application/json', data: btoa(bin) }); return '已保存到 ' + r.path } catch (e) { return '导出失败：' + ((e as Error)?.message || e) }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  a.download = name
  a.click()
  return '已导出'
}

/**
 * 导入：只认本 App 导出的表，先清空再写入，一个事务里完成（失败不留半套）。
 * ok = 写进去了（调用方重新载入）；msg 给用户看，空 = 用户取消
 */
export async function importBackup(file: File): Promise<{ ok: boolean; msg: string }> {
  let data: Record<string, unknown>
  try { data = JSON.parse(await file.text()) } catch { return { ok: false, msg: '不是有效的备份文件' } }
  // 浏览器插件导出的收词：按多设备合并的规则合进来，不覆盖现有记录
  if (data.app === 'sayday-clips') {
    const snap = data.snapshot as Snapshot
    const n = snap?.tables?.card?.length ?? 0
    if (!n) return { ok: false, msg: '这个文件里没有收的词' }
    try { await mergeSnapshot(snap) } catch (e) { return { ok: false, msg: '导入失败：' + ((e as Error).message || e) } }
    return { ok: true, msg: `收进 ${n} 个词（已有的没动），正在重新载入` }
  }
  if (data.app !== 'sayday') return { ok: false, msg: '这不是日日说的备份文件' }
  const tables = TABLES.filter((t) => Array.isArray(data[t]))
  const n = tables.reduce((s, t) => s + (data[t] as unknown[]).length, 0)
  if (!confirm(`用备份（${String(data.exported).slice(0, 10)}，共 ${n} 条记录）覆盖现在的学习记录？`)) return { ok: false, msg: '' }
  const items: { sql: string; params?: unknown[] }[] = []
  for (const t of tables) {
    items.push({ sql: `DELETE FROM ${t}` })
    const cols = await db.all<{ name: string }>(`PRAGMA table_info(${t})`)
    const ok = new Set(cols.map((c) => c.name))
    for (const row of data[t] as Record<string, unknown>[]) {
      const ks = Object.keys(row).filter((k) => ok.has(k))
      if (ks.length) items.push({ sql: `INSERT INTO ${t}(${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`, params: ks.map((k) => row[k]) })
    }
  }
  try { await db.batch(items) } catch (e) { return { ok: false, msg: '导入失败：' + ((e as Error).message || e) } }
  return { ok: true, msg: '已恢复，正在重新载入' }
}

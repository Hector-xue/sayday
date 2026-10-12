import { useEffect, useState } from 'react'
import { useApp, type Theme } from '../store'
import { Icon } from '../components/icons'
import { db } from '../lib/db'
import { goalLabel } from '../lib/levels'
import { isNative } from '../lib/speech/engine'
import { getAi, providerOf, type AiConfig } from '../lib/ai'
import { canRemind, enableReminder, getReminder, type Reminder } from '../lib/reminder'

export function Settings({ onRedo, onAi, onBack }: { onRedo: (what: 'goal' | 'place') => void; onAi: () => void; onBack: () => void }) {
  const { profile, setProfile, theme, setTheme, toast } = useApp()
  const [storage, setStorage] = useState<string>('')
  const [ai, setAiCfg] = useState<AiConfig | null>(null)
  const { tick } = useApp()
  useEffect(() => { getAi().then(setAiCfg) }, [tick])
  const [rem, setRem] = useState<Reminder | null>(null)
  useEffect(() => { getReminder().then(setRem) }, [])
  const saveRem = async (r: Reminder) => {
    const err = await enableReminder(r)
    if (err) { toast(err); return }
    setRem(r)
    toast(r.on ? `每天 ${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')} 提醒你；当天练过就不提醒` : '已关闭提醒')
  }
  useEffect(() => { db.info().then((i) => setStorage(i.mode === 'opfs' ? '本机存储（OPFS）' : i.mode === 'local' ? '浏览器存储（容量有限，建议用 App）' : '临时内存（关掉就没了，请换浏览器或用 App）')) }, [])
  if (!profile) return null

  const exportData = async () => {
    // 录音存档（recording）是二进制、体积大，不放进 JSON 备份
    const tables = ['kv', 'card', 'review_log', 'attempt', 'phoneme_stat', 'day', 'level_estimate', 'listen_log', 'chat', 'diary', 'speaking_test', 'writing', 'practice']
    const out: Record<string, unknown> = { app: 'sayday', exported: new Date().toISOString() }
    for (const t of tables) out[t] = await db.all(`SELECT * FROM ${t}`)
    const json = JSON.stringify(out)
    const name = `sayday-备份-${new Date().toISOString().slice(0, 10)}.json`
    const tauri = (globalThis as any).__TAURI__?.core
    if (tauri) {
      // App 里 WebView 不处理下载：交给原生插件写进系统“下载/Sayday”
      const u8 = new TextEncoder().encode(json)
      let bin = ''
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as unknown as number[])
      try { const r = await tauri.invoke('plugin:sayday-infer|save_to_downloads', { name, mime: 'application/json', data: btoa(bin) }); toast('已保存到 ' + r.path) } catch (e) { toast('导出失败：' + ((e as Error)?.message || e)) }
      return
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    a.download = name
    a.click()
    toast('已导出')
  }
  // 导入备份：换手机、卸载重装后恢复。只认本 App 导出的表，先清空再写入，一个事务里完成（失败不留半套）
  const importData = async (file: File) => {
    let data: Record<string, unknown>
    try { data = JSON.parse(await file.text()) } catch { toast('不是有效的备份文件'); return }
    if (data.app !== 'sayday') { toast('这不是日日说的备份文件'); return }
    const allowed = ['kv', 'card', 'review_log', 'attempt', 'phoneme_stat', 'day', 'level_estimate', 'listen_log', 'chat', 'diary', 'speaking_test', 'writing', 'practice']
    const tables = allowed.filter((t) => Array.isArray(data[t]))
    const n = tables.reduce((s, t) => s + (data[t] as unknown[]).length, 0)
    if (!confirm(`用备份（${String(data.exported).slice(0, 10)}，共 ${n} 条记录）覆盖现在的学习记录？`)) return
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
    try { await db.batch(items) } catch (e) { toast('导入失败：' + ((e as Error).message || e)); return }
    toast('已恢复，正在重新载入'); setTimeout(() => location.reload(), 800)
  }
  const reset = async () => {
    if (!confirm('清空所有学习记录？这一步不能撤销，建议先导出备份。')) return
    await db.batch(['card', 'review_log', 'attempt', 'phoneme_stat', 'day', 'level_estimate', 'listen_log', 'recording', 'chat', 'diary', 'speaking_test', 'writing', 'practice', 'kv'].map((t) => ({ sql: `DELETE FROM ${t}` })))
    location.reload()
  }

  return (
    <div className="page fade-in">
      <div className="page-head" style={{ justifyContent: 'flex-start', gap: 6 }}><button className="icon-btn ghost" aria-label="返回" onClick={onBack} style={{ marginLeft: -10 }}><Icon.back /></button><h1>设置</h1></div>
      <p className="section-title" style={{ marginTop: 0 }}>学习</p>
      <div className="list">
        <div className="set-row"><div className="k"><b>目标</b><span>{goalLabel(profile.goal)}（{profile.goal.target}）</span></div><button className="btn small quiet" onClick={() => onRedo('goal')}>修改</button></div>
        <div className="set-row">
          <div className="k"><b>每天</b><span>按这个时间排每天的量</span></div>
          <div className="seg">{[10, 20, 30, 45].map((m) => <button key={m} aria-pressed={profile.minutes === m} onClick={() => setProfile({ ...profile, minutes: m })}>{m}</button>)}</div>
        </div>
        <div className="set-row">
          <div className="k"><b>示范口音</b><span>听示范和例句用的声音</span></div>
          <div className="seg"><button aria-pressed={profile.accent === 'us'} onClick={() => setProfile({ ...profile, accent: 'us' })}>美音</button><button aria-pressed={profile.accent === 'gb'} onClick={() => setProfile({ ...profile, accent: 'gb' })}>英音</button></div>
        </div>
        {canRemind && rem && (
          <div className="set-row">
            <div className="k"><b>每日提醒</b><span>{rem.on ? '当天练过就不打扰' : '到点提醒你练一会儿'}</span></div>
            {rem.on && <input className="input time" type="time" value={`${String(rem.hour).padStart(2, '0')}:${String(rem.minute).padStart(2, '0')}`} onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); if (!Number.isNaN(h)) saveRem({ on: true, hour: h, minute: m || 0 }) }} />}
            <div className="seg"><button aria-pressed={!rem.on} onClick={() => saveRem({ ...rem, on: false })}>关</button><button aria-pressed={rem.on} onClick={() => saveRem({ ...rem, on: true })}>开</button></div>
          </div>
        )}
        <div className="set-row"><div className="k"><b>重新定级</b><span>当前起点 {profile.placement.cefr} · 约 {profile.placement.vocab.toLocaleString()} 词</span></div><button className="btn small quiet" onClick={() => onRedo('place')}>重测</button></div>
      </div>

      <p className="section-title">AI</p>
      <div className="list">
        <div className="set-row"><div className="k"><b>你自己的 AI</b><span>{ai ? `${providerOf(ai.provider).name} · ${ai.model}` : '陪练聊天、日记批改要用。DeepSeek、通义、Kimi 等都行'}</span></div><button className="btn small quiet" onClick={onAi}>{ai ? '修改' : '接入'}</button></div>
      </div>

      <p className="section-title">外观</p>
      <div className="list">
        <div className="set-row">
          <div className="k"><b>主题</b></div>
          <div className="seg">{([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as [Theme, string][]).map(([k, t]) => <button key={k} aria-pressed={theme === k} onClick={() => setTheme(k)}>{t}</button>)}</div>
        </div>
      </div>

      <p className="section-title">数据</p>
      <div className="list">
        <div className="set-row"><div className="k"><b>保存在</b><span>{storage}{isNative ? ' · App' : ''}</span></div></div>
        <div className="set-row"><div className="k"><b>导出备份</b><span>全部学习记录，JSON 文件</span></div><button className="btn small quiet" onClick={exportData}>导出</button></div>
        <div className="set-row"><div className="k"><b>导入备份</b><span>换手机、重装后用导出的文件恢复</span></div><label className="btn small quiet" style={{ display: 'inline-grid', placeItems: 'center' }}>选择文件<input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importData(f) }} /></label></div>
        <div className="set-row"><div className="k"><b>清空记录</b><span>从头开始</span></div><button className="btn small quiet" style={{ color: 'var(--bad)' }} onClick={reset}>清空</button></div>
      </div>

      <p className="section-title">关于</p>
      <div className="card">
        <p className="small muted">日日说 · MIT 开源 · 所有练习数据只在你的设备上，录音不上传。</p>
        <p className="small muted" style={{ marginTop: 8 }}>词典 ECDICT（MIT）· 例句 Tatoeba（CC BY 2.0 FR）· 发音词典 CMUdict（BSD）· 评测数据 speechocean762（CC BY 4.0）· 示范语音 Kokoro（Apache-2.0，预先生成）· 音素识别 Charsiu（Zhu 等，2022）· 语音识别 Moonshine（MIT）</p>
        <p className="small" style={{ marginTop: 8 }}><a href="https://github.com/Hector-xue/sayday" style={{ color: 'var(--brand)' }}>源码与完整致谢</a></p>
      </div>
    </div>
  )
}

// 设置页“多设备同步”：没开 → 开启 / 用同步码加入；开了 → 同步码（点一下显示、可复制）、立即同步、退出
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { disableSync, enableSync, getSync, getSyncState, syncNow, validCode, type SyncCfg, type SyncState } from '../lib/sync'

const ago = (ts: number) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前` }

export function SyncRows() {
  const { toast, refresh } = useApp()
  const [cfg, setCfg] = useState<SyncCfg | null | undefined>(undefined)
  const [st, setSt] = useState<SyncState | null>(null)
  const [show, setShow] = useState(false)
  const [joining, setJoining] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => { getSync().then(setCfg); getSyncState().then(setSt) }
  useEffect(load, [])
  const run = async (f: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try { await f(); if (ok) toast(ok) } catch (e) { toast((e as Error).message || String(e)) } finally { setBusy(false); load(); refresh() }
  }
  if (cfg === undefined) return null
  if (!cfg) return (
    <>
      <div className="set-row">
        <div className="k"><b>多设备同步</b><span>手机、网页、平板用同一份学习记录。端到端加密，服务器看不到内容</span></div>
        <button className="btn small quiet" disabled={busy} onClick={() => run(async () => { await enableSync(); await syncNow(); setShow(true) }, '已开启，把同步码抄到别的设备上')}>开启</button>
      </div>
      {joining ? (
        <div className="set-row sync-join">
          <input className="input sync-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="输入另一台设备的同步码" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
          <button className="btn small primary" disabled={busy || !validCode(code)} onClick={() => run(async () => {
            await enableSync(code)
            try { await syncNow() } catch (e) { await disableSync(); throw e }
            // 档案（目标、口音）以原来的设备为准：重新载入
            setTimeout(() => location.reload(), 600)
          }, '已接上，正在载入')}>接上</button>
        </div>
      ) : (
        <div className="set-row"><div className="k"><b>已经有同步码</b><span>在别的设备上开过同步</span></div><button className="btn small quiet" onClick={() => setJoining(true)}>输入</button></div>
      )}
    </>
  )
  return (
    <>
      <div className="set-row">
        <div className="k"><b>多设备同步</b><span>{st?.error ? `上次失败：${st.error}` : st?.last ? `${ago(st.last)}同步过 · 共 ${st.devices} 台设备` : '还没同步过'}</span></div>
        <button className="btn small quiet" disabled={busy} onClick={() => run(syncNow, '同步好了')}>{busy ? '同步中…' : '立即同步'}</button>
      </div>
      <div className="set-row">
        <div className="k"><b>同步码</b><span className={show ? 'en sync-code-show' : ''}>{show ? cfg.code : '在别的设备上输入它就能接上。别发给别人'}</span></div>
        <button className="btn small quiet" onClick={async () => { if (!show) { setShow(true); return } try { await navigator.clipboard.writeText(cfg.code); toast('已复制') } catch { toast('复制不了，手动抄一下') } }}>{show ? '复制' : '显示'}</button>
      </div>
      <div className="set-row">
        <div className="k"><b>这台设备退出同步</b><span>本机的学习记录留着，只是不再和别的设备同步</span></div>
        <button className="btn small quiet" onClick={() => { if (confirm('这台设备退出同步？')) run(disableSync, '已退出') }}>退出</button>
      </div>
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { installUpdate, skipUpdate, startUpdate, updateStatus, type UpdateInfo, type UpdateState } from '../lib/update'

const mb = (n: number) => (n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1)

/** 新版本提示 + 下载进度 + 安装。onClose：点“以后再说”（这一版之后不再自动提示） */
export function UpdateCard({ info, onClose }: { info: UpdateInfo; onClose?: () => void }) {
  const [st, setSt] = useState<UpdateState | null>(null)
  const [hint, setHint] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = undefined }
  useEffect(() => stop, [])

  const poll = () => {
    stop()
    timer.current = window.setInterval(async () => {
      try {
        const s = await updateStatus()
        setSt(s)
        if (s.state !== 'running') { stop(); if (s.state === 'done') install() }
      } catch { stop() }
    }, 400)
  }

  const download = async () => {
    setHint('')
    try { setSt(await startUpdate(info)); poll() } catch (e) { setSt({ state: 'error', done: 0, total: info.size, error: (e as Error).message || String(e), current: info.current }) }
  }

  const install = async () => {
    try {
      const opened = await installUpdate()
      setHint(opened ? '在系统弹出的窗口里点“安装”即可，学习记录都在' : '先在刚打开的系统设置里允许“日日说”安装应用，回来再点一次“安装”')
    } catch (e) { setHint('打不开安装器：' + ((e as Error).message || e)) }
  }

  const state = st?.state ?? 'idle'
  const pct = st && st.total > 0 ? Math.min(100, (st.done / st.total) * 100) : 0

  return (
    <div className="card update-card">
      <div className="update-head">
        <span className="update-tag">新版本</span>
        <b>{info.version}</b>
        <span className="small muted">当前 {info.current}</span>
      </div>
      {info.title && <p className="update-title">{info.title}</p>}
      {info.points.length > 0 && <ul className="update-points">{info.points.map((p) => <li key={p}>{p}</li>)}</ul>}

      {state === 'running' && (
        <div className="update-progress">
          <div className="bar"><i style={{ width: `${pct}%` }} /></div>
          <span className="small muted">下载中 {mb(st!.done)} / {mb(st!.total || info.size)} MB</span>
        </div>
      )}
      {state === 'error' && <p className="small" style={{ color: 'var(--bad)', marginTop: 10 }}>{st!.error || '下载失败'}</p>}
      {hint && <p className="small muted" style={{ marginTop: 10 }}>{hint}</p>}

      <div className="update-actions">
        {state === 'idle' && <button className="btn small primary" onClick={download}>更新{info.size ? `（${mb(info.size)} MB）` : ''}</button>}
        {state === 'error' && <button className="btn small primary" onClick={download}>重试</button>}
        {state === 'done' && <button className="btn small primary" onClick={install}>安装</button>}
        {onClose && state !== 'running' && state !== 'done' && <button className="btn small ghost" onClick={() => { skipUpdate(info.version); onClose() }}>以后再说</button>}
      </div>
    </div>
  )
}

// 里程碑庆祝：全屏一页，大数字 + 一句话 + 撒彩纸；可以存成分享图
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { saveCard, type Milestone } from '../lib/milestones'
import { sfx } from '../lib/feedback'
import { useCountUp } from './motion'
import { useApp } from '../store'

const COLORS = ['var(--sun)', 'var(--good)', 'var(--brand)', '#FF8A65', '#7E57C2']

export function Celebrate({ m, onClose }: { m: Milestone; onClose: () => void }) {
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  useEffect(() => { sfx('cheer') }, [])
  const big = useCountUp(m.n, 900)
  const bits = useMemo(() => Array.from({ length: 28 }, (_, i) => ({ left: Math.random() * 100, delay: Math.random() * 0.6, dur: 1.6 + Math.random() * 1.2, rot: Math.random() * 360, c: COLORS[i % COLORS.length], w: 6 + Math.random() * 6 })), [])
  const save = async () => {
    setBusy(true)
    try { const msg = await saveCard(m); if (msg) toast(msg) } catch (e) { toast('存图失败：' + ((e as Error).message || e)) } finally { setBusy(false) }
  }
  return createPortal(
    <div className="celebrate fade-in" role="dialog" aria-label={m.title}>
      <div className="confetti" aria-hidden>{bits.map((b, i) => <i key={i} style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, background: b.c, width: b.w, transform: `rotate(${b.rot}deg)` }} />)}</div>
      <div className="celebrate-body">
        <p className="small muted">里程碑</p>
        <div className="celebrate-num"><mark>{m.kind === 'words' || m.kind === 'shadows' ? big.toLocaleString() : big}</mark><small>{m.unit}</small></div>
        <h2>{m.title}</h2>
        <p className="muted">{m.line}</p>
      </div>
      <div className="celebrate-foot">
        <button className="btn quiet" style={{ flex: 1 }} disabled={busy} onClick={save}>{busy ? '生成中…' : '存成图片'}</button>
        <button className="btn primary" style={{ flex: 2 }} onClick={onClose}>好</button>
      </div>
    </div>,
    document.body,
  )
}

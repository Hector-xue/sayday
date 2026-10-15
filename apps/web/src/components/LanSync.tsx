// 面对面同步的界面：出码（显示二维码 + 地址和配对码）/ 扫码（摄像头，或者手动输入）
import { useEffect, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import { Overlay } from './Overlay'
import { joinHost, parseManual, parseSessionText, pollHost, sessionText, showAddr, startHost, stopHost, validPair, type LanResult, type Session } from '../lib/lan'

function Qr({ text }: { text: string }) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`
  // 二维码固定白底黑块（深色模式下也一样，不然扫不出）
  return <svg className="lan-qr" viewBox={`0 0 ${n + 8} ${n + 8}`} shapeRendering="crispEdges" role="img" aria-label="配对二维码"><rect width={n + 8} height={n + 8} fill="#fff" /><path d={d} fill="#000" /></svg>
}

/** 出码：开端口、显示二维码，等另一台连过来 */
export function LanHost({ onDone }: { onDone: (r: LanResult) => void }) {
  const [s, setS] = useState<Session | null>(null)
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true, timer = 0
    setErr(''); setS(null)
    startHost().then(({ session, keys }) => {
      if (!alive) return
      setS(session)
      const tick = async () => {
        try {
          const r = await pollHost(keys)
          if (!alive) return
          if (r) onDone(r)
          else timer = window.setTimeout(tick, 600)
        } catch (e) { if (alive) setErr((e as Error).message) }
      }
      tick()
    }).catch((e) => alive && setErr((e as Error).message))
    return () => { alive = false; clearTimeout(timer); stopHost() }
  }, [n])
  if (err) return <div className="lan-box"><div className="err-box">{err}</div><button className="btn primary block" onClick={() => setN((x) => x + 1)}>重新出码</button></div>
  if (!s) return <div className="lan-box"><p className="muted">正在准备…</p></div>
  return (
    <div className="lan-box">
      <Qr text={sessionText(s)} />
      <p className="lan-wait"><span className="lan-dot" />等另一台扫码，5 分钟内有效</p>
      <div className="lan-manual">
        <span className="small muted">另一台扫不了，就手动输入：</span>
        <div><span className="small muted">地址</span><b className="en">{showAddr(s)}</b></div>
        <div><span className="small muted">配对码</span><b className="en">{s.code}</b></div>
      </div>
      <p className="small muted">电脑上第一次出码，系统可能问要不要允许联网，选允许。</p>
    </div>
  )
}

/** 摄像头扫二维码：有 BarcodeDetector 用它，没有用 jsQR */
function Scanner({ onText, onFail }: { onText: (t: string) => void; onFail: (msg: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    let alive = true, stream: MediaStream | null = null, timer = 0
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch {
        if (alive) onFail('打不开摄像头（没给权限，或者这台设备没有摄像头）。可以手动输入另一台上显示的地址和配对码')
        return
      }
      if (!alive) { stream.getTracks().forEach((t) => t.stop()); return }
      const v = video.current!
      v.srcObject = stream
      await v.play().catch(() => {})
      const BD = (globalThis as any).BarcodeDetector
      let detector: any = null
      try { if (BD && (await BD.getSupportedFormats?.())?.includes('qr_code')) detector = new BD({ formats: ['qr_code'] }) } catch { detector = null }
      const jsQR = detector ? null : (await import('jsqr')).default
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const scan = async () => {
        if (!alive) return
        try {
          if (v.videoWidth) {
            let text: string | undefined
            if (detector) text = (await detector.detect(v))[0]?.rawValue
            else {
              const k = Math.min(1, 640 / v.videoWidth)
              canvas.width = Math.round(v.videoWidth * k); canvas.height = Math.round(v.videoHeight * k)
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
              text = jsQR!(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data
            }
            if (text && alive) { onText(text); return }
          }
        } catch { /* 这一帧没认出来 */ }
        timer = window.setTimeout(scan, 200)
      }
      scan()
    })()
    return () => { alive = false; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()) }
  }, [])
  return <div className="lan-cam"><video ref={video} playsInline muted /><i /></div>
}

/** 扫码那一边：扫到 / 输入后连过去。fresh = 新设备第一次接（设置以老设备为准） */
export function LanJoin({ fresh, onDone }: { fresh?: boolean; onDone: (r: LanResult) => void }) {
  const [mode, setMode] = useState<'scan' | 'type'>('scan')
  const [addr, setAddr] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async (s: Session) => {
    setBusy(true); setErr('')
    try { onDone(await joinHost(s, fresh)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const onText = (t: string) => {
    const s = parseSessionText(t)
    if (s) go(s)
    else { setErr('这不是日日说的配对码。在另一台上打开 设置 → 面对面同步 → 在这台出码'); setMode('type') }
  }
  const typed = parseManual(addr, code)
  if (busy) return <div className="lan-box"><p className="lan-wait"><span className="lan-dot" />连上了，正在交换学习记录…</p></div>
  return (
    <div className="lan-box">
      {err && <div className="err-box">{err}</div>}
      {mode === 'scan' && !err ? (
        <>
          <Scanner onText={onText} onFail={(m) => { setErr(m); setMode('type') }} />
          <p className="small muted">对准另一台上的二维码</p>
          <button className="btn ghost block" onClick={() => setMode('type')}>手动输入</button>
        </>
      ) : (
        <>
          <label className="lan-field"><span className="small muted">地址</span><input className="input en" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="192.168.1.5" inputMode="decimal" autoCorrect="off" spellCheck={false} /></label>
          <label className="lan-field"><span className="small muted">配对码</span><input className="input en sync-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XX" autoCapitalize="characters" autoCorrect="off" spellCheck={false} /></label>
          <button className="btn primary block" disabled={!typed} onClick={() => typed && go(typed)}>{addr && code && !typed ? (validPair(code) ? '地址格式不对' : '配对码是 10 位') : '连接'}</button>
          <button className="btn ghost block" onClick={() => { setErr(''); setMode('scan') }}>改用扫码</button>
        </>
      )}
    </div>
  )
}

export function lanResultText(r: LanResult) {
  return r.changed ? `合好了：两台设备的学习记录已经合到一起（这台更新了 ${r.changed} 处）` : '合好了：两边本来就一样'
}

/** 设置里打开的整页：选出码还是扫码 → 交换 → 结果 */
export function LanSyncPage({ onClose }: { onClose: () => void }) {
  const [role, setRole] = useState<'pick' | 'host' | 'join'>('pick')
  const [done, setDone] = useState<LanResult | null>(null)
  // 合进来了东西：重新载入，各页面（档案、今天、进步）都按新记录算
  const close = () => { if (done?.changed) location.reload(); else onClose() }
  return (
    <Overlay title="面对面同步" sub="同一个 Wi-Fi 下两台设备直接传，不经过服务器" onClose={close}>
      <div className="fade-in lan-page">
        {done ? (
          <div className="lan-box">
            <p className="lan-ok">✓</p>
            <p>{lanResultText(done)}</p>
            <button className="btn primary block" onClick={close}>好了</button>
          </div>
        ) : role === 'pick' ? (
          <>
            <p className="small muted">两台设备都打开日日说、连同一个 Wi-Fi（没有 Wi-Fi 就让一台开热点、另一台连上）。一台出码，另一台扫码，两边的学习记录就合到一起。</p>
            <button className="card lan-pick" onClick={() => setRole('host')}><b>在这台出码</b><span className="small muted">另一台来扫这里的二维码</span></button>
            <button className="card lan-pick" onClick={() => setRole('join')}><b>扫另一台的码</b><span className="small muted">没有摄像头可以手动输入地址和配对码</span></button>
          </>
        ) : role === 'host' ? <LanHost onDone={setDone} /> : <LanJoin onDone={setDone} />}
      </div>
    </Overlay>
  )
}

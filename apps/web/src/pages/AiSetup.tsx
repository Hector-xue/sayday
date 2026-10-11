// 接入 AI：选服务商 + 贴密钥 → 连接（自动挑模型并真问一句）。地址和模型收在“高级”里
import { useEffect, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { AiError, PROVIDERS, connect, getAi, guessProvider, providerOf, saveAi, type AiConfig } from '../lib/ai'
import { useApp } from '../store'

export function AiSetup({ onClose }: { onClose: (connected: boolean) => void }) {
  const { toast } = useApp()
  const [cur, setCur] = useState<AiConfig | null>(null)
  const [provider, setProvider] = useState('deepseek')
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [adv, setAdv] = useState(false)
  const [base, setBase] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    getAi().then((c) => {
      if (!c) return
      setCur(c); setProvider(c.provider); setKey(c.key); setBase(c.base ?? ''); setModel(c.model ?? '')
    })
  }, [])
  const p = providerOf(provider)

  const onKey = (k: string) => {
    setKey(k.trim()); setErr('')
    const g = guessProvider(k.trim())
    if (g) setProvider(g)
  }
  const go = async () => {
    setBusy(true); setErr('')
    try {
      // 换了服务商就让它重新挑模型（除非高级里手填了）
      const keepModel = cur && cur.provider === provider && model ? model : adv && model ? model : undefined
      const c = await connect({ provider, key, base: base || undefined, model: keepModel })
      await saveAi(c)
      toast(`已接入 ${p.name}（${c.model}）`)
      onClose(true)
    } catch (e) {
      setErr(e instanceof AiError ? e.message : '连接失败：' + ((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }
  const off = async () => { await saveAi(null); toast('已断开 AI'); onClose(false) }

  return (
    <Overlay title="接入你自己的 AI" onClose={() => onClose(false)} foot={
      <div className="row">
        {cur && <button className="btn quiet" style={{ flex: 1 }} onClick={off}>断开</button>}
        <button className="btn primary" style={{ flex: 2 }} disabled={busy || (!key && !p.noKey) || (provider === 'custom' && !base)} onClick={go}>{busy ? '连接中…' : '连接'}</button>
      </div>
    }>
      <p className="small muted" style={{ marginBottom: 14 }}>AI 陪练和日记批改用你自己的 AI 账号。密钥只存在这台设备上，直接发给你选的服务商，不经过我们。</p>
      <p className="section-title" style={{ marginTop: 0 }}>服务商</p>
      <div className="options cols-3">
        {PROVIDERS.map((x) => (
          <button key={x.id} className="opt" style={{ padding: '10px 10px', textAlign: 'center' }} aria-pressed={provider === x.id} onClick={() => { setProvider(x.id); setErr('') }}>
            <b style={{ fontSize: 14 }}>{x.name}</b>
          </button>
        ))}
      </div>
      {!p.noKey && (
        <>
          <p className="section-title">密钥（API Key）</p>
          <div className="row">
            <input className="input" style={{ flex: 1 }} type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="sk-…" value={key} onChange={(e) => onKey(e.target.value)} />
            <button className="btn small quiet" onClick={() => setShow(!show)}>{show ? '隐藏' : '显示'}</button>
          </div>
          {p.keyUrl && <p className="small" style={{ marginTop: 8 }}><a href={p.keyUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>去 {p.name} 后台拿密钥 ↗</a></p>}
        </>
      )}
      {p.note && <p className="small muted" style={{ marginTop: 8 }}>{p.note}</p>}
      {err && <div className="err-box">{err}</div>}

      <button className="btn ghost small" style={{ marginTop: 18, paddingLeft: 0 }} onClick={() => setAdv(!adv)}>{adv || provider === 'custom' ? '收起高级 ▴' : '高级 ▾'}</button>
      {(adv || provider === 'custom') && (
        <div className="card" style={{ marginTop: 8 }}>
          <p className="small muted">接口地址{provider === 'custom' ? '（必填，OpenAI 兼容）' : `（默认 ${p.base}）`}</p>
          <input className="input" style={{ marginTop: 6 }} placeholder={p.base || 'https://…/v1'} value={base} onChange={(e) => setBase(e.target.value.trim())} />
          <p className="small muted" style={{ marginTop: 12 }}>模型（留空自动挑）</p>
          <input className="input" style={{ marginTop: 6 }} placeholder={p.fallback || '例如 gpt-4o-mini'} value={model} onChange={(e) => setModel(e.target.value.trim())} />
        </div>
      )}
      {cur?.checked && <p className="small faint" style={{ marginTop: 16 }}>当前：{providerOf(cur.provider).name} · {cur.model}</p>}
    </Overlay>
  )
}

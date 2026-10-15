// 工作英语：选场景 → 看你收到的英文和要求 → 写（自动存草稿）→ AI 批改；没接 AI 就对照参考写法自己改
import { useEffect, useRef, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { PlayButton } from '../components/PlayButton'
import { Tappable } from '../components/Tappable'
import { useApp } from '../store'
import { AiError, getAi, type AiConfig } from '../lib/ai'
import { KIND_ZH, checkWork, loadTasks, saveWork, workDraftKey, workHistory, type Task, type WorkResult } from '../lib/work'
import { kvGet, kvSet } from '../lib/db'
import { words } from '../lib/writing'
import { markDay } from '../lib/lesson'

export function Work({ onClose, onSetup }: { onClose: () => void; onSetup: () => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [open, setOpen] = useState<Task | null>(null)
  const [hist, setHist] = useState<Awaited<ReturnType<typeof workHistory>>>([])
  useEffect(() => { loadTasks().then(setTasks); workHistory().then(setHist) }, [open])
  if (!tasks) return <Overlay title="工作英语" onClose={onClose}><div className="loading">…</div></Overlay>
  if (open) return <Editor t={open} onBack={() => setOpen(null)} onSetup={onSetup} />
  const last = new Map<string, number | null>()
  for (const h of [...hist].reverse()) last.set(h.task, h.score)
  return (
    <Overlay title="工作英语" sub="跨境电商的真实场景，学了当天就能用" onClose={onClose}>
      <div className="list">
        {tasks.map((t) => (
          <button className="list-row" key={t.id} onClick={() => setOpen(t)}>
            <span className="main"><b style={{ fontSize: 15, whiteSpace: 'normal' }}>{t.title_zh}</b><span>{KIND_ZH[t.kind]} · {t.level}{last.has(t.id) ? (last.get(t.id) != null ? ` · 上次 ${last.get(t.id)!.toFixed(1)} 分` : ' · 写过') : ''}</span></span>
          </button>
        ))}
      </div>
      <p className="small faint" style={{ margin: '14px 4px' }}>场景和参考写法都是原创的。接入 AI 后能逐句批改；没接也能对照参考写法。</p>
    </Overlay>
  )
}

function Editor({ t, onBack, onSetup }: { t: Task; onBack: () => void; onSetup: () => void }) {
  const { profile } = useApp()
  const [text, setText] = useState('')
  const [cfg, setCfg] = useState<AiConfig | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState<WorkResult | null>(null)
  const [model, setModel] = useState(false)
  const loaded = useRef(false)
  const opened = useRef(performance.now())
  useEffect(() => {
    getAi().then(setCfg)
    kvGet<string>(workDraftKey(t.id), '').then((x) => { setText(x); loaded.current = true })
    return () => { markDay({ seconds: (performance.now() - opened.current) / 1000 }) }
  }, [])
  useEffect(() => { if (!loaded.current) return; const h = setTimeout(() => kvSet(workDraftKey(t.id), text), 600); return () => clearTimeout(h) }, [text])
  const n = words(text)
  const go = async () => {
    if (!cfg) { await saveWork(t.id, text.trim(), null); setModel(true); return }
    setBusy(true); setErr('')
    try {
      const r = await checkWork(cfg, t, text.trim())
      await saveWork(t.id, text.trim(), r)
      await kvSet(workDraftKey(t.id), '')
      setRes(r)
    } catch (e) { setErr(e instanceof AiError ? e.message : '出错了：' + ((e as Error).message || e)) } finally { setBusy(false) }
  }
  if (res) return (
    <Overlay title="批改结果" sub={t.title_zh} onClose={onBack} foot={<button className="btn primary block" onClick={onBack}>回到场景列表</button>}>
      <div className="fade-in">
        <div className="card raised" style={{ textAlign: 'center' }}>
          <p className="small muted">AI 评分（满分 10）</p>
          <div className="report-level" style={{ fontSize: 56 }}>{res.score.toFixed(1)}</div>
          {res.tone && <p className="small muted">语气：{res.tone}</p>}
          <p style={{ marginTop: 10, textAlign: 'left' }}>{res.comment}</p>
        </div>
        {res.covered.length > 0 && <><p className="section-title">做到了的</p><ul className="tips" style={{ background: 'var(--good-bg)' }}>{res.covered.map((x) => <li key={x}>{x}</li>)}</ul></>}
        {res.missing.length > 0 && <><p className="section-title">还缺的</p><ul className="tips">{res.missing.map((x) => <li key={x}>{x}</li>)}</ul></>}
        {res.edits.length > 0 && <><p className="section-title">逐句改</p><div className="list">{res.edits.map((e, i) => <div className="edit" key={i}><p><s className="from">{e.from}</s> → <b className="to en">{e.to}</b></p>{e.why && <p className="small muted">{e.why}</p>}</div>)}</div></>}
        <p className="section-title">地道写法</p>
        <div className="card"><p className="en" style={{ fontSize: 16, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{res.better}</p>
          <div className="row" style={{ marginTop: 10 }}><PlayButton text={res.better} accent={profile!.accent} label="听一遍" /><span className="small muted">听一遍</span></div></div>
        {res.phrases.length > 0 && <><p className="section-title">值得记的说法</p><div className="list">{res.phrases.map((p, i) => <div className="list-row" key={i}><span className="main"><b>{p.en}</b><span>{p.zh}</span></span></div>)}</div></>}
        <p className="section-title">你写的</p>
        <div className="card"><p className="en" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{text}</p></div>
      </div>
    </Overlay>
  )
  return (
    <Overlay title={t.title_zh} sub={`${KIND_ZH[t.kind]} · ${t.level}`} onClose={onBack}
      right={<button className="btn small ghost" onClick={() => setModel((m) => !m)}>{model ? '收起参考' : '参考写法'}</button>}
      foot={<button className="btn primary block" disabled={busy || n < 8} onClick={go}>{busy ? 'AI 在看…（约 20 秒）' : cfg ? '提交批改' : '写好了，对照参考写法'}</button>}>
      <div className="fade-in work">
        <p>{t.task_zh}</p>
        {t.material && <div className="card material"><p className="small muted">你收到的</p><p className="en"><Tappable text={t.material} /></p></div>}
        <ul className="tips">{t.hints_zh.map((h) => <li key={h}>{h}</li>)}</ul>
        <textarea className="diary-edit" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.kind === 'email' ? 'Hi …,' : t.kind === 'listing' ? '' : 'Hi, thanks for …'} />
        <p className="small muted">{n} 词 · 自动保存草稿{cfg === null ? ' · 接入 AI 后能逐句批改' : ''}{cfg === null && <button className="btn small ghost" onClick={onSetup}>去接入</button>}</p>
        {err && <div className="err-box">{err}</div>}
        {model && (
          <>
            <p className="section-title">参考写法</p>
            <div className="card"><p className="en" style={{ fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}><Tappable text={t.model} /></p></div>
            <p className="section-title">值得记的说法</p>
            <div className="list">{t.phrases.map((p, i) => <div className="list-row" key={i}><span className="main"><b>{p.en}</b><span>{p.zh}</span></span></div>)}</div>
          </>
        )}
      </div>
    </Overlay>
  )
}

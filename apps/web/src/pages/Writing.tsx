// 雅思写作：选题 → 写（自动存草稿、可计时）→ AI 按四项打分 + 逐句改错 + 7.5 分改写
import { useEffect, useRef, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { PlayButton } from '../components/PlayButton'
import { useApp } from '../store'
import { AiError, getAi, type AiConfig } from '../lib/ai'
import { draftKey, gradeWriting, loadWriting, minWords, saveWriting, words, writingHistory, type Prompt, type WBank, type WKind, type WResult } from '../lib/writing'
import { IeltsChart } from '../components/IeltsChart'
import type { ChartType } from '../lib/ielts-chart'
import { kvGet, kvSet } from '../lib/db'

const CHART_ZH: Record<string, string> = { line: '折线图', bar: '柱状图', pie: '饼图', table: '表格' }
const TYPE_ZH: Record<string, string> = { opinion: '讨论双方 + 观点', agree: '同意 / 不同意', problem: '问题 + 解决', adv: '利弊' }

export function Writing({ onClose, onSetup }: { onClose: () => void; onSetup: () => void }) {
  const [bank, setBank] = useState<WBank | null>(null)
  const [tab, setTab] = useState<'task1' | 'task2' | 'letters'>('task2')
  const [open, setOpen] = useState<null | { p: Prompt; kind: WKind }>(null)
  const [hist, setHist] = useState<Awaited<ReturnType<typeof writingHistory>>>([])
  const [view, setView] = useState<null | { p: Prompt | undefined; text: string; r: WResult }>(null)
  useEffect(() => { loadWriting().then(setBank); writingHistory().then(setHist) }, [open])
  if (!bank) return <Overlay title="雅思写作" onClose={onClose}><div className="loading">…</div></Overlay>
  const all = [...(bank.task1 ?? []), ...bank.task2, ...bank.letters]
  if (open) return <Editor p={open.p} kind={open.kind} onBack={() => setOpen(null)} onSetup={onSetup} />
  if (view) return (
    <Overlay title="批改结果" sub={view.p?.prompt.slice(0, 40)} onClose={() => setView(null)}>
      <Result r={view.r} text={view.text} />
    </Overlay>
  )
  const done = new Map(hist.map((h) => [h.prompt_id, h]))
  return (
    <Overlay title="雅思写作" sub="写完由你接入的 AI 按官方四项标准批改" onClose={onClose}>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button aria-pressed={tab === 'task1'} onClick={() => setTab('task1')}>小作文 Task 1</button>
        <button aria-pressed={tab === 'task2'} onClick={() => setTab('task2')}>大作文 Task 2</button>
        <button aria-pressed={tab === 'letters'} onClick={() => setTab('letters')}>书信（G 类）</button>
      </div>
      <div className="list">
        {(bank[tab] ?? []).map((p) => {
          const h = done.get(p.id)
          return (
            <button className="list-row" key={p.id} onClick={() => setOpen({ p, kind: tab === 'letters' ? 'letter' : tab })}>
              <span className="main"><b style={{ fontSize: 15, whiteSpace: 'normal' }}>{p.zh}</b><span>{tab === 'task1' ? CHART_ZH[p.type ?? ''] : p.type ? TYPE_ZH[p.type] : '书信'} · 至少 {minWords(tab === 'letters' ? 'letter' : tab)} 词{h?.band ? ` · 上次 ${h.band.toFixed(1)}` : ''}</span></span>
            </button>
          )
        })}
      </div>
      {hist.some((h) => h.result) && (
        <>
          <p className="section-title">批改记录</p>
          <div className="list">
            {hist.filter((h) => h.result).map((h) => (
              <button className="list-row" key={h.id} onClick={() => setView({ p: all.find((p) => p.id === h.prompt_id), text: h.text, r: h.result! })}>
                <span className="main"><b style={{ fontSize: 15 }}>{h.band?.toFixed(1)} 分</b><span>{new Date(h.ts).toLocaleDateString()} · {all.find((p) => p.id === h.prompt_id)?.zh.slice(0, 24)}</span></span>
              </button>
            ))}
          </div>
        </>
      )}
      <p className="small faint" style={{ margin: '14px 4px' }}>题目为日日说原创的雅思风格练习题，不是真题；分数是练习参考。</p>
    </Overlay>
  )
}

function Editor({ p, kind, onBack, onSetup }: { p: Prompt; kind: WKind; onBack: () => void; onSetup: () => void }) {
  const letter = kind === 'letter'
  const [text, setText] = useState('')
  const [cfg, setCfg] = useState<AiConfig | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState<WResult | null>(null)
  const [start, setStart] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const loaded = useRef(false)
  useEffect(() => { getAi().then(setCfg); kvGet<string>(draftKey(p.id), '').then((t) => { setText(t); loaded.current = true }) }, [])
  // 自动存草稿
  useEffect(() => { if (!loaded.current) return; const h = setTimeout(() => kvSet(draftKey(p.id), text), 600); return () => clearTimeout(h) }, [text])
  useEffect(() => { if (!start) return; const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h) }, [start])
  const n = words(text), min = minWords(kind), limit = kind === 'task2' ? 40 : 20
  const used = start ? Math.floor((now - start) / 60000) : 0
  const go = async () => {
    if (!cfg) { onSetup(); return }
    setBusy(true); setErr('')
    try {
      const r = await gradeWriting(cfg, p, kind, text.trim())
      await saveWriting(p.id, text.trim(), r)
      await kvSet(draftKey(p.id), '')
      setRes(r)
    } catch (e) { setErr(e instanceof AiError ? e.message : '出错了：' + ((e as Error).message || e)) } finally { setBusy(false) }
  }
  if (res) return <Overlay title="批改结果" onClose={onBack} foot={<button className="btn primary block" onClick={onBack}>回到题目列表</button>}><Result r={res} text={text} /></Overlay>
  return (
    <Overlay title={letter ? '书信' : kind === 'task1' ? '小作文' : '大作文'} sub={start ? `已写 ${used} 分钟 / 建议 ${limit} 分钟` : `建议 ${limit} 分钟`} onClose={onBack}
      right={!start && <button className="btn small ghost" onClick={() => setStart(Date.now())}>计时</button>}
      foot={<button className="btn primary block" disabled={busy || n < 30} onClick={go}>{busy ? 'AI 在批改…（约半分钟）' : cfg === null ? '接入 AI 后批改' : n < min ? `提交批改（才 ${n} 词，不到 ${min} 会扣分）` : '提交批改'}</button>}>
      <div className="card"><p className="en" style={{ fontSize: 16, lineHeight: 1.6 }}>{p.prompt}</p><p className="small muted" style={{ marginTop: 6 }}>{p.zh}</p></div>
      {kind === 'task1' && p.chart && <div style={{ marginTop: 12 }}><IeltsChart type={p.type as ChartType} c={p.chart} /></div>}
      <textarea className="diary-edit" style={{ marginTop: 12 }} rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={letter ? 'Dear …,' : kind === 'task1' ? 'The chart shows …' : 'In recent years, …'} />
      <p className={`small ${n >= min ? 'muted' : 'faint'}`} style={{ marginTop: 6 }}>{n} / {min} 词 · 自动保存草稿</p>
      {err && <div className="err-box">{err}</div>}
    </Overlay>
  )
}

function Result({ r, text }: { r: WResult; text: string }) {
  const { profile } = useApp()
  const rows: [string, number][] = [['任务回应', r.tr], ['连贯衔接', r.cc], ['词汇', r.lr], ['语法', r.gra]]
  return (
    <div className="fade-in">
      <div className="card raised" style={{ textAlign: 'center' }}>
        <p className="small muted">总分（AI 评估）</p>
        <div className="report-level" style={{ fontSize: 56 }}>{r.overall.toFixed(1)}</div>
        <div className="band-rows">{rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{v.toFixed(1)}</b></div>)}</div>
        <p style={{ marginTop: 12, textAlign: 'left' }}>{r.summary}</p>
      </div>
      {r.strengths.length > 0 && <><p className="section-title">写得好的</p><ul className="tips" style={{ background: 'var(--good-bg)' }}>{r.strengths.map((t) => <li key={t}>{t}</li>)}</ul></>}
      {r.improve.length > 0 && <><p className="section-title">最该改的</p><ul className="tips">{r.improve.map((t) => <li key={t}>{t}</li>)}</ul></>}
      {r.edits.length > 0 && (
        <>
          <p className="section-title">逐句改错</p>
          <div className="list">{r.edits.map((e, i) => <div className="edit" key={i}><p><s className="from">{e.from}</s> → <b className="to en">{e.to}</b></p>{e.why && <p className="small muted">{e.why}</p>}</div>)}</div>
        </>
      )}
      <p className="section-title">7.5 分改写</p>
      <div className="card"><p className="en" style={{ fontSize: 16, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{r.rewrite}</p>
        <div className="row" style={{ marginTop: 10 }}><PlayButton text={r.rewrite} accent={profile!.accent} label="听改写" /><span className="small muted">听一遍</span></div></div>
      {r.phrases.length > 0 && <><p className="section-title">值得记的表达</p><div className="list">{r.phrases.map((p, i) => <div className="list-row" key={i}><span className="main"><b>{p.en}</b><span>{p.zh}</span></span></div>)}</div></>}
      <p className="section-title">你写的</p>
      <div className="card"><p className="en" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{text}</p></div>
      <p className="small faint" style={{ margin: '14px 4px' }}>AI 评分是练习参考，和考官评分会有出入。</p>
    </div>
  )
}

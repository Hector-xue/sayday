// 模拟考试：雅思全真模考（听力 30 分钟 → 阅读 60 分钟 → 写作 60 分钟 → 口语约 12 分钟，最后出四项 + 总分），
// 中途可以退出，下次从没考的那一节接着考；也能单独练某一项。所有人都能用，不只是目标选了雅思的
import { useEffect, useRef, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { IeltsChart } from '../components/IeltsChart'
import { useApp } from '../store'
import { kvGet, kvSet } from '../lib/db'
import { getAi } from '../lib/ai'
import { MockSection, Practice } from './Practice'
import { Speaking } from './Speaking'
import { Writing } from './Writing'
import { gradeWriting, loadWriting, saveWriting, words, writingHistory, type Prompt } from '../lib/writing'
import { practiceHistory } from '../lib/practice'
import { roundBand } from '../lib/ielts'
import { overallBand } from '../lib/growth'
import type { ChartType } from '../lib/ielts-chart'

type Step = 'listening' | 'reading' | 'writing' | 'speaking'
const STEPS: { k: Step; t: string; min: string; how: string }[] = [
  { k: 'listening', t: '听力', min: '约 30 分钟', how: '四个部分连着放，只放一遍。先看题，边听边答' },
  { k: 'reading', t: '阅读', min: '60 分钟', how: '三篇文章 40 题，到点自动交卷。一篇别超过 20 分钟' },
  { k: 'writing', t: '写作', min: '60 分钟', how: '小作文（图表）20 分钟 + 大作文 40 分钟。大作文分量是小作文的两倍' },
  { k: 'speaking', t: '口语', min: '约 12 分钟', how: '考官提问，三个部分，你开口答' },
]
type Bands = Partial<Record<Step, number | null>>
export type MockRun = { id: number; test: number; done: Step[]; bands: Bands; raw: Partial<Record<Step, string>>; finished?: number }

const getRun = () => kvGet<MockRun | null>('mock_run', null)
const getHistory = () => kvGet<MockRun[]>('mock_history', [])

/** 总分：四项都有才是正式总分；写作没评分（没接 AI）时按其余三项估，并标出来 */
export function mockOverall(b: Bands): { band: number | null; partial: boolean } {
  const xs = STEPS.map((s) => b[s.k]).filter((x): x is number => typeof x === 'number')
  if (!xs.length) return { band: null, partial: true }
  return { band: overallBand(xs), partial: xs.length < 4 }
}

export function Mock({ onClose, onSetupAi }: { onClose: () => void; onSetupAi: () => void }) {
  const { refresh } = useApp()
  const [run, setRun] = useState<MockRun | null | undefined>(undefined)
  const [hist, setHist] = useState<MockRun[]>([])
  const [test, setTest] = useState(1)
  const [section, setSection] = useState<Step | null>(null)
  const [single, setSingle] = useState<null | 'listening' | 'reading' | 'writing' | 'speaking'>(null)
  const [report, setReport] = useState<MockRun | null>(null)
  const load = async () => {
    setRun(await getRun()); setHist(await getHistory())
    // 默认挑做得最少的那一套
    const done = await practiceHistory()
    const n = (t: number) => done.filter((h) => h.test === t && h.part === 0).length
    setTest([1, 2, 3].sort((a, b) => n(a) - n(b))[0])
  }
  useEffect(() => { load() }, [])
  const save = async (r: MockRun | null) => { await kvSet('mock_run', r); setRun(r) }
  const finishStep = async (k: Step, band: number | null, raw?: string) => {
    const r = { ...run!, done: [...run!.done.filter((x) => x !== k), k], bands: { ...run!.bands, [k]: band }, raw: { ...run!.raw, ...(raw ? { [k]: raw } : {}) } }
    if (r.done.length === STEPS.length) {
      r.finished = Date.now()
      const h = [r, ...(await getHistory())].slice(0, 30)
      await kvSet('mock_history', h); setHist(h)
      await save(null); setReport(r)
    } else await save(r)
    setSection(null); refresh()
  }

  if (run === undefined) return <Overlay title="模拟考试" onClose={onClose}><div className="loading">…</div></Overlay>
  // ---- 单项练习：直接用原来的页面 ----
  if (single === 'listening' || single === 'reading') return <Practice kind={single} onClose={() => setSingle(null)} />
  if (single === 'writing') return <Writing onClose={() => setSingle(null)} onSetup={onSetupAi} />
  if (single === 'speaking') return <Speaking onClose={() => setSingle(null)} onSetupAi={onSetupAi} />
  // ---- 全真模考的某一节 ----
  if (run && section === 'listening') return <MockSection kind="listening" test={run.test} onExit={() => setSection(null)} onDone={(r) => finishStep('listening', r.band, `${r.score}/${r.total}`)} />
  if (run && section === 'reading') return <MockSection kind="reading" test={run.test} onExit={() => setSection(null)} onDone={(r) => finishStep('reading', r.band, `${r.score}/${r.total}`)} />
  if (run && section === 'writing') return <MockWriting onExit={() => setSection(null)} onSetupAi={onSetupAi} onDone={(b) => finishStep('writing', b)} />
  if (run && section === 'speaking') return <Speaking onClose={() => setSection(null)} onSetupAi={onSetupAi} onFinished={(b) => finishStep('speaking', b)} />
  if (report) return <MockReport r={report} onClose={() => setReport(null)} />

  if (run) {
    const next = STEPS.find((s) => !run.done.includes(s.k))!
    return (
      <Overlay title="雅思全真模考" sub={`第 ${run.test} 套 · 已考 ${run.done.length}/4`} onClose={onClose}
        foot={<button className="btn primary block" onClick={() => setSection(next.k)}>开始{next.t}（{next.min}）</button>}>
        <div className="fade-in mock">
          <ol className="mock-steps">
            {STEPS.map((s) => <li key={s.k} className={run.done.includes(s.k) ? 'done' : s.k === next.k ? 'now' : ''}><b>{s.t}</b><span>{run.done.includes(s.k) ? '考完了' : s.min}</span></li>)}
          </ol>
          <div className="card"><b>下一节：{next.t}</b><p className="small muted" style={{ marginTop: 4 }}>{next.how}</p></div>
          <p className="small muted">真考时四项连着考。累了可以先退出，下次打开从{next.t}接着考；分数等四项考完一起出。</p>
          <button className="btn ghost block" onClick={async () => { if (confirm('放弃这次模考？已考的几节记录会留着，但不出总分。')) await save(null) }}>放弃这次模考</button>
        </div>
      </Overlay>
    )
  }

  return (
    <Overlay title="模拟考试" sub="雅思全真四项，或者单练一项" onClose={onClose}
      foot={<button className="btn primary block" onClick={() => save({ id: Date.now(), test, done: [], bands: {}, raw: {} })}>开始全真模考（约 2 小时 45 分）</button>}>
      <div className="fade-in mock">
        <div className="card">
          <b>雅思全真模考</b>
          <p className="small muted" style={{ marginTop: 4 }}>听力 → 阅读 → 写作 → 口语，按真考时长和顺序来。中途可以退出、下次接着考。考完出四项分数和总分，计入进步页的雅思预估。</p>
          <div className="row" style={{ marginTop: 10 }}><span className="small muted">用第几套</span><div className="spacer" /><div className="seg">{[1, 2, 3].map((t) => <button key={t} aria-pressed={test === t} onClick={() => setTest(t)}>{t}</button>)}</div></div>
        </div>
        <p className="section-title">单项练习</p>
        <div className="ai-grid">
          <button className="card ai-card" onClick={() => setSingle('listening')}><b>听力</b><span>按部分练或整套，可选只放一遍</span></button>
          <button className="card ai-card" onClick={() => setSingle('reading')}><b>阅读</b><span>按篇练或整套，看解析和原文依据</span></button>
          <button className="card ai-card" onClick={() => setSingle('writing')}><b>写作</b><span>小作文（图表）、大作文、书信，AI 批改</span></button>
          <button className="card ai-card" onClick={() => setSingle('speaking')}><b>口语</b><span>三个部分完整走一遍</span></button>
        </div>
        {hist.length > 0 && (
          <>
            <p className="section-title">模考记录</p>
            <div className="list">
              {hist.map((h) => {
                const o = mockOverall(h.bands)
                return (
                  <button className="list-row" key={h.id} onClick={() => setReport(h)}>
                    <span className="main"><b>总分 {o.band?.toFixed(1) ?? '—'}{o.partial ? '（不完整）' : ''}</b><span>{new Date(h.finished ?? h.id).toLocaleDateString()} · 第 {h.test} 套 · {STEPS.map((s) => `${s.t} ${h.bands[s.k]?.toFixed(1) ?? '—'}`).join(' · ')}</span></span>
                  </button>
                )
              })}
            </div>
          </>
        )}
        <p className="small faint">题目都是日日说原创的雅思风格题，不是真题；听力、阅读按官方常用换算表估分，写作、口语由你接入的 AI 按官方四项标准评分，仅供参考。</p>
      </div>
    </Overlay>
  )
}

function MockReport({ r, onClose }: { r: MockRun; onClose: () => void }) {
  const o = mockOverall(r.bands)
  return (
    <Overlay title="模考成绩" sub={`第 ${r.test} 套 · ${new Date(r.finished ?? r.id).toLocaleDateString()}`} onClose={onClose} foot={<button className="btn primary block" onClick={onClose}>好的</button>}>
      <div className="fade-in mock">
        <div className="card raised" style={{ textAlign: 'center' }}>
          <p className="small muted">总分{o.partial ? '（不完整，按考了的几项估）' : ''}</p>
          <div className="report-level" style={{ fontSize: 56 }}>{o.band?.toFixed(1) ?? '—'}</div>
          <div className="band-rows">{STEPS.map((s) => <div key={s.k}><span>{s.t}</span><b>{r.bands[s.k]?.toFixed(1) ?? '—'}</b></div>)}</div>
        </div>
        <ul className="tips">
          {r.raw.listening && <li>听力答对 {r.raw.listening}</li>}
          {r.raw.reading && <li>阅读答对 {r.raw.reading}</li>}
          {r.bands.writing == null && <li>写作没有评分：接入 AI 后，在“单项练习 → 写作 → 批改记录”里能补评</li>}
          {r.bands.speaking == null && <li>口语没出分：录音太短或没识别出内容</li>}
          <li>每一项的答案、解析、逐句修改都在单项练习的记录里</li>
        </ul>
      </div>
    </Overlay>
  )
}

/** 模考写作：小作文 + 大作文一共 60 分钟，两篇切换着写；交卷后（接了 AI）两篇一起批改，大作文算两份 */
function MockWriting({ onExit, onDone, onSetupAi }: { onExit: () => void; onDone: (band: number | null) => void; onSetupAi: () => void }) {
  const [ps, setPs] = useState<{ t1: Prompt; t2: Prompt } | null>(null)
  const [tab, setTab] = useState<1 | 2>(1)
  const [d, setD] = useState<{ t1: string; t2: string; start: number } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const sent = useRef(false)
  useEffect(() => {
    ;(async () => {
      const [bank, h, saved] = await Promise.all([loadWriting(), writingHistory(50), kvGet<{ t1: string; t2: string; start: number; ids?: string[] } | null>('mock_writing', null)])
      const used = new Set(h.map((x) => x.prompt_id))
      const pick = (list: Prompt[]) => list.find((p) => !used.has(p.id)) ?? list[Math.floor(Math.random() * list.length)]
      const t1 = (saved?.ids && bank.task1.find((p) => p.id === saved.ids![0])) || pick(bank.task1)
      const t2 = (saved?.ids && bank.task2.find((p) => p.id === saved.ids![1])) || pick(bank.task2)
      setPs({ t1, t2 })
      setD(saved && saved.ids ? saved : { t1: '', t2: '', start: Date.now() })
    })()
    const h = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(h)
  }, [])
  useEffect(() => { if (d && ps) kvSet('mock_writing', { ...d, ids: [ps.t1.id, ps.t2.id] }) }, [d?.t1, d?.t2])
  const left = d ? 3600 - Math.floor((now - d.start) / 1000) : 3600
  const submit = async () => {
    if (!ps || !d || sent.current) return
    sent.current = true
    setBusy(true)
    const cfg = await getAi()
    let band: number | null = null
    try {
      if (cfg && words(d.t1) >= 20 && words(d.t2) >= 20) {
        const [a, b] = await Promise.all([gradeWriting(cfg, ps.t1, 'task1', d.t1), gradeWriting(cfg, ps.t2, 'task2', d.t2)])
        await saveWriting(ps.t1.id, d.t1, a); await saveWriting(ps.t2.id, d.t2, b)
        band = roundBand((a.overall + 2 * b.overall) / 3)
      } else {
        if (d.t1.trim()) await saveWriting(ps.t1.id, d.t1, null)
        if (d.t2.trim()) await saveWriting(ps.t2.id, d.t2, null)
      }
    } catch { /* 批改失败：分数留空，作文已存，单项里能补评 */ }
    await kvSet('mock_writing', null)
    setBusy(false)
    onDone(band)
  }
  useEffect(() => { if (left <= 0) submit() }, [left <= 0])
  if (!ps || !d) return <Overlay title="写作" onClose={onExit}><div className="loading">…</div></Overlay>
  const p = tab === 1 ? ps.t1 : ps.t2
  const text = tab === 1 ? d.t1 : d.t2
  const n = words(text), min = tab === 1 ? 150 : 250
  return (
    <Overlay title="写作" sub={`还剩 ${Math.max(0, Math.floor(left / 60))}:${String(Math.max(0, left % 60)).padStart(2, '0')}`} onClose={() => { if (confirm('先退出？写的内容会保存，回来接着写，计时不停。')) onExit() }}
      foot={<button className="btn primary block" disabled={busy} onClick={() => { if (confirm('交卷？交了就不能再改了。')) submit() }}>{busy ? 'AI 在批改两篇…（约一分钟）' : `交卷（小作文 ${words(d.t1)} 词 · 大作文 ${words(d.t2)} 词）`}</button>}>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button aria-pressed={tab === 1} onClick={() => setTab(1)}>Task 1 · 建议 20 分钟</button>
        <button aria-pressed={tab === 2} onClick={() => setTab(2)}>Task 2 · 建议 40 分钟</button>
      </div>
      <div className="card"><p className="en" style={{ fontSize: 15, lineHeight: 1.6, margin: 0 }}>{p.prompt}</p></div>
      {tab === 1 && p.chart && <div style={{ marginTop: 10 }}><IeltsChart type={p.type as ChartType} c={p.chart} /></div>}
      <textarea className="diary-edit" style={{ marginTop: 12 }} rows={12} value={text} onChange={(e) => setD({ ...d, [tab === 1 ? 't1' : 't2']: e.target.value })} placeholder={tab === 1 ? 'The chart shows …' : 'In recent years, …'} />
      <p className={`small ${n >= min ? 'muted' : 'faint'}`} style={{ marginTop: 6 }}>{n} / {min} 词 · 自动保存</p>
      <MockAiHint onSetupAi={onSetupAi} />
    </Overlay>
  )
}

function MockAiHint({ onSetupAi }: { onSetupAi: () => void }) {
  const [has, setHas] = useState(true)
  useEffect(() => { getAi().then((c) => setHas(!!c)) }, [])
  if (has) return null
  return <p className="small muted">写作要接入 AI 才能评分；不接也能写，作文会存下来，接了以后再补评。<button className="btn small ghost" onClick={onSetupAi}>去接入</button></p>
}

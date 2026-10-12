// 雅思阅读 / 听力练习：选一篇（一部分）或整套 → 作答 → 本机判分，逐题给答案、解析和原文依据
// 听力默认“考试模式”：和真考一样只放一遍；练习模式可以暂停、重听上一句
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Overlay } from '../components/Overlay'
import { PlayButton } from '../components/PlayButton'
import { Icon } from '../components/icons'
import { useApp } from '../store'
import { play, prefetch, stopAudio } from '../lib/tts'
import { markDay } from '../lib/lesson'
import { kvGet, kvSet } from '../lib/db'
import {
  TF, band, clipOfLine, grade, letter, loadListening, loadReading, practiceHistory, savePractice, target7,
  type Answer, type Group, type Item, type ListeningTest, type Part, type Passage, type PracticeRow, type ReadingTest, type Result,
} from '../lib/practice'

type Kind = 'reading' | 'listening'
type Unit = Passage | Part
const NAME = { reading: '雅思阅读', listening: '雅思听力' }
const count = (u: Unit) => u.groups.reduce((a, g) => a + g.items.length, 0)
const range = (u: Unit) => { const all = u.groups.flatMap((g) => g.items.map((i) => i.n)); return `${all[0]}–${all.at(-1)}` }

export function Practice({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const [tests, setTests] = useState<(ReadingTest | ListeningTest)[] | null>(null)
  const [hist, setHist] = useState<PracticeRow[]>([])
  const [run, setRun] = useState<null | { test: number; units: Unit[]; full: boolean }>(null)
  useEffect(() => { (kind === 'reading' ? loadReading() : loadListening()).then(setTests); practiceHistory(kind).then(setHist) }, [run])
  if (!tests) return <Overlay title={NAME[kind]} onClose={onClose}><div className="loading">…</div></Overlay>
  if (run) return <Run kind={kind} {...run} onExit={() => setRun(null)} />
  const last = (test: number, part: number) => hist.find((h) => h.test === test && h.part === part)
  return (
    <Overlay title={NAME[kind]} sub={kind === 'reading' ? '学术类 · 一篇约 20 分钟' : '四个部分 · 一部分约 6~8 分钟'} onClose={onClose}>
      {tests.map((t) => {
        const units: Unit[] = 'passages' in t ? t.passages : t.parts
        const full = last(t.id, 0)
        return (
          <div key={t.id}>
            <p className="section-title">第 {t.id} 套</p>
            <div className="list">
              {units.map((u) => {
                const h = last(t.id, u.n)
                return (
                  <button className="list-row" key={u.n} onClick={() => setRun({ test: t.id, units: [u], full: false })}>
                    <span className="main">
                      <b className="en" style={{ fontSize: 16 }}>{kind === 'reading' ? `Passage ${u.n} · ${u.title}` : `Part ${u.n} · ${u.title}`}</b>
                      <span>{'title_zh' in u ? u.title_zh : u.context_zh.replace(/^第.部分：/, '')} · 第 {range(u)} 题{h ? ` · 上次 ${h.score}/${h.total}` : ''}</span>
                    </span>
                  </button>
                )
              })}
              <button className="list-row" onClick={() => setRun({ test: t.id, units, full: true })}>
                <span className="main"><b>整套模考（40 题）</b><span>{kind === 'reading' ? '三篇连着做，限时 60 分钟' : '四部分连着放，约 30 分钟，只放一遍'}{full ? ` · 上次 ${full.score}/40 ≈ ${full.band.toFixed(1)}` : ''}</span></span>
              </button>
            </div>
          </div>
        )
      })}
      {hist.length > 0 && (
        <>
          <p className="section-title">练习记录</p>
          <div className="list">
            {hist.slice(0, 10).map((h) => (
              <div className="list-row" key={h.id}>
                <span className="main"><b style={{ fontSize: 15 }}>{h.score}/{h.total} · 约 {h.band.toFixed(1)} 分</b><span>{new Date(h.ts).toLocaleDateString()} · 第 {h.test} 套 {h.part ? (kind === 'reading' ? `第 ${h.part} 篇` : `Part ${h.part}`) : '整套'}</span></span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="small faint" style={{ margin: '14px 4px' }}>题目为日日说原创的雅思风格练习题，不是真题；分数按官方常用换算表估算，单篇按比例折算，仅供参考。</p>
    </Overlay>
  )
}

function Run({ kind, test, units, full, onExit }: { kind: Kind; test: number; units: Unit[]; full: boolean; onExit: () => void }) {
  const { refresh } = useApp()
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState<Record<number, Answer>>({})
  const [res, setRes] = useState<Result | null>(null)
  const [start] = useState(Date.now())
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h) }, [])
  useEffect(() => () => stopAudio(), [])
  const u = units[i]
  const groups = units.flatMap((x) => x.groups)
  const set = (n: number, v: Answer) => setAnswers((a) => ({ ...a, [n]: v }))
  const submit = async () => {
    stopAudio()
    const r = grade(groups, answers)
    await savePractice(kind, test, full ? 0 : u.n, r, answers)
    await markDay({ seconds: Math.round((Date.now() - start) / 1000) })
    refresh()
    setRes(r)
  }
  if (res) return <Report kind={kind} test={test} units={units} answers={answers} res={res} onExit={onExit} />
  const mins = Math.floor((now - start) / 60000)
  const limit = kind === 'reading' ? units.reduce((a, x) => a + (x as Passage).minutes, 0) : 0
  const answered = groups.flatMap((g) => g.items).filter((it) => answers[it.n] != null && answers[it.n] !== '').length
  const last = i === units.length - 1
  const foot = (
    <button className="btn primary block" onClick={() => {
      if (!last) { setI(i + 1); document.querySelector('.session-body')?.scrollTo(0, 0); return }
      if (answered < groups.reduce((a, g) => a + g.items.length, 0) && !confirm(`还有 ${groups.reduce((a, g) => a + g.items.length, 0) - answered} 题没答，确定交卷？`)) return
      submit()
    }}>{last ? `交卷（已答 ${answered}）` : kind === 'reading' ? '下一篇' : '下一部分'}</button>
  )
  const title = kind === 'reading' ? `Passage ${u.n}` : `Part ${u.n}`
  const sub = kind === 'reading' ? `已用 ${mins} 分钟 / 建议 ${limit} 分钟${units.length > 1 ? ` · 第 ${i + 1}/${units.length} 篇` : ''}` : `${(u as Part).context_zh}`
  return (
    <Overlay title={title} sub={sub} onClose={() => { if (answered === 0 || confirm('退出后这次的作答不会保存，确定退出？')) onExit() }} foot={foot}>
      {kind === 'reading'
        ? <ReadingView key={i} p={u as Passage} answers={answers} set={set} />
        : <ListeningView key={i} test={test} p={u as Part} answers={answers} set={set} full={full} />}
    </Overlay>
  )
}

function ReadingView({ p, answers, set }: { p: Passage; answers: Record<number, Answer>; set: (n: number, v: Answer) => void }) {
  const [tab, setTab] = useState<'text' | 'q'>('text')
  return (
    <>
      <div className="seg sticky-seg">
        <button aria-pressed={tab === 'text'} onClick={() => setTab('text')}>文章</button>
        <button aria-pressed={tab === 'q'} onClick={() => setTab('q')}>题目（{range(p)}）</button>
      </div>
      {tab === 'text' ? <PassageText p={p} /> : <Questions groups={p.groups} answers={answers} set={set} />}
      {tab === 'text' && <button className="btn block" style={{ marginTop: 14 }} onClick={() => { setTab('q'); document.querySelector('.session-body')?.scrollTo(0, 0) }}>去答题</button>}
    </>
  )
}

function PassageText({ p, marks = [] }: { p: Passage; marks?: string[] }) {
  return (
    <div className="card passage">
      <h3 className="en">{p.title}</h3>
      {p.paras.map((t, k) => (
        <p key={k} className="en">{p.lettered && <b className="para-letter">{letter(k)}</b>}<Hl text={t} marks={marks} /></p>
      ))}
    </div>
  )
}

/** 把依据片段在原文里标出来 */
function Hl({ text, marks }: { text: string; marks: string[] }) {
  const hits = marks.map((m) => [text.indexOf(m), m.length] as const).filter(([s]) => s >= 0).sort((a, b) => a[0] - b[0])
  if (!hits.length) return <>{text}</>
  const out: ReactNode[] = []
  let pos = 0
  hits.forEach(([s, l], k) => { if (s < pos) return; out.push(text.slice(pos, s), <mark key={k}>{text.slice(s, s + l)}</mark>); pos = s + l })
  out.push(text.slice(pos))
  return <>{out}</>
}

function ListeningView({ test, p, answers, set, full }: { test: number; p: Part; answers: Record<number, Answer>; set: (n: number, v: Answer) => void; full: boolean }) {
  const { profile } = useApp()
  const accent = profile!.accent
  const [exam, setExam] = useState(true)
  const [state, setState] = useState<'ready' | 'playing' | 'paused' | 'done'>('ready')
  const [cur, setCur] = useState(0)
  const stop = useRef(false)
  const pos = useRef(0)
  useEffect(() => { kvGet<boolean>('listening_exam', true).then(setExam); prefetch(p.lines.map((l, k) => clipOfLine(test, p.n, k, l)), accent) }, [])
  const go = async (from: number) => {
    stop.current = false
    setState('playing')
    for (let k = from; k < p.lines.length; k++) {
      pos.current = k
      setCur(k)
      try { await play(clipOfLine(test, p.n, k, p.lines[k]), accent) } catch { /* 这句没音频：跳过 */ }
      if (stop.current) return
      await new Promise((r) => setTimeout(r, p.lines[k + 1]?.who !== p.lines[k].who ? 450 : 250))
      if (stop.current) return
    }
    setState('done')
  }
  const pause = () => { stop.current = true; stopAudio(); setState('paused') }
  const toggleExam = () => { const v = !exam; setExam(v); kvSet('listening_exam', v) }
  return (
    <>
      <div className="card listen-bar">
        {state === 'ready' && (
          <>
            <p className="small muted">先花半分钟看一遍题目，猜猜要填什么词，准备好了再开始播放。</p>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => go(0)}><Icon.play /> 开始播放</button>
              <div className="spacer" />
              {!full && <button className="btn small quiet" onClick={toggleExam}>{exam ? '考试模式：只放一遍' : '练习模式：可暂停重听'}</button>}
            </div>
          </>
        )}
        {state !== 'ready' && (
          <>
            <div className="row">
              <b className="small">{state === 'done' ? '播放结束，检查一下答案再交卷' : state === 'paused' ? '已暂停' : `正在播放 · ${p.cast[p.lines[cur].who].name}`}</b>
              <div className="spacer" />
              {!exam && !full && state !== 'done' && (
                <>
                  <button className="icon-btn" aria-label="上一句" onClick={() => { pause(); setTimeout(() => go(Math.max(0, pos.current - 1)), 50) }}><Icon.back /></button>
                  {state === 'playing'
                    ? <button className="icon-btn" aria-label="暂停" onClick={pause}><Icon.stop /></button>
                    : <button className="icon-btn" aria-label="继续" onClick={() => go(pos.current)}><Icon.play /></button>}
                </>
              )}
            </div>
            <div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${state === 'done' ? 100 : (cur / p.lines.length) * 100}%` }} /></div>
          </>
        )}
      </div>
      <Questions groups={p.groups} answers={answers} set={set} />
    </>
  )
}

function Questions({ groups, answers, set }: { groups: Group[]; answers: Record<number, Answer>; set: (n: number, v: Answer) => void }) {
  return (
    <>
      {groups.map((g, gi) => (
        <div key={gi} className="q-group">
          <p className="section-title">第 {g.items[0].n}–{g.items.at(-1)!.n} 题 · {g.instr_zh}</p>
          <p className="small muted en" style={{ margin: '0 4px 10px' }}>{g.instr}</p>
          {g.options?.some((o) => o.length > 2) && <div className="card q-options">{g.options.map((o) => <p key={o} className="en small">{o}</p>)}</div>}
          {g.title && <p className="en q-title">{g.title}</p>}
          {g.items.map((it) => <Q key={it.n} g={g} it={it} v={answers[it.n] ?? null} set={(v) => set(it.n, v)} />)}
        </div>
      ))}
    </>
  )
}

function Q({ g, it, v, set }: { g: Group; it: Item; v: Answer; set: (v: Answer) => void }) {
  if (g.type === 'gap') {
    const [a, b] = it.q.split('___')
    return (
      <div className="q gap">
        <span className="q-n">{it.n}</span>
        <p className="en">{a}<input className="gap-input" value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label={`第 ${it.n} 题`} />{b}</p>
      </div>
    )
  }
  return (
    <div className="q">
      <span className="q-n">{it.n}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="en">{it.q}</p>
        {g.type === 'tfng' || g.type === 'ynng' ? (
          <div className="q-choices">{TF[g.type].map(([k, l]) => <button key={k} className="chip" aria-pressed={v === k} onClick={() => set(k)}>{l}</button>)}</div>
        ) : g.type === 'mc' ? (
          <div className="q-choices col">{it.options!.map((o, k) => <button key={k} className="chip wide en" aria-pressed={v === k} onClick={() => set(k)}><b>{letter(k)}</b> {o}</button>)}</div>
        ) : (
          <div className="q-choices">{g.options!.map((o, k) => <button key={k} className="chip" aria-pressed={v === k} onClick={() => set(k)} title={o}>{o.split('.')[0]}</button>)}</div>
        )}
      </div>
    </div>
  )
}

const shown = (g: Group, it: Item, v: Answer | string[] | number | string): string => {
  if (v === null || v === '' || v === undefined) return '未答'
  if (g.type === 'tfng' || g.type === 'ynng') return TF[g.type].find(([k]) => k === v)?.[1] ?? String(v)
  if (g.type === 'mc') return `${letter(v as number)}. ${it.options![v as number]}`
  if (g.type === 'pick') return g.options![v as number]
  return Array.isArray(v) ? v[0] : String(v)
}

function Report({ kind, test, units, answers, res, onExit }: { kind: Kind; test: number; units: Unit[]; answers: Record<number, Answer>; res: Result; onExit: () => void }) {
  const { profile } = useApp()
  const [open, setOpen] = useState<number | null>(null)
  const b = band(kind, res.right, res.total)
  const need = target7(res.total)
  return (
    <Overlay title="成绩" sub={`${NAME[kind]} · 第 ${test} 套`} onClose={onExit} foot={<button className="btn primary block" onClick={onExit}>回到题目列表</button>}>
      <div className="card raised fade-in" style={{ textAlign: 'center' }}>
        <p className="small muted">答对 {res.right} / {res.total}</p>
        <div className="report-level" style={{ fontSize: 56 }}>{b.toFixed(1)}</div>
        <p className="small muted">{res.total < 40 ? '按比例折算的估计分' : '按官方常用换算表估算'} · 7 分大约要对 {need} 题{res.right >= need ? '，这次达到了 ✓' : `，还差 ${need - res.right} 题`}</p>
      </div>
      {units.map((u) => (
        <div key={u.n}>
          <p className="section-title">{kind === 'reading' ? `Passage ${u.n} · ${u.title}` : `Part ${u.n} · ${u.title}`} · 对 {u.groups.flatMap((g) => g.items).filter((it) => res.marks[it.n]).length}/{count(u)}</p>
          <div className="list">
            {u.groups.flatMap((g) => g.items.map((it) => {
              const ok = res.marks[it.n]
              return (
                <div className={`q-res ${ok ? 'right' : 'wrong'}`} key={it.n}>
                  <p><b className="q-n">{it.n}</b> <span className="en">{it.q}</span></p>
                  <p className="small">{ok ? '✓ ' : '✗ 你的答案：' + shown(g, it, answers[it.n] ?? null) + ' · 正确：'}<b className="en">{shown(g, it, it.a)}</b></p>
                  <p className="small muted">{it.why}</p>
                  <p className="small faint en">原文：“{it.at}”</p>
                </div>
              )
            }))}
          </div>
          <button className="btn block quiet" style={{ marginTop: 10 }} onClick={() => setOpen(open === u.n ? null : u.n)}>{open === u.n ? '收起原文' : kind === 'reading' ? '看原文（标出了答案依据）' : '看录音原文（每句可重听）'}</button>
          {open === u.n && (kind === 'reading'
            ? <div style={{ marginTop: 10 }}><PassageText p={u as Passage} marks={u.groups.flatMap((g) => g.items.map((it) => it.at))} /></div>
            : <div className="card" style={{ marginTop: 10 }}>{(u as Part).lines.map((l, k) => (
                <div className="row transcript-line" key={k}>
                  <PlayButton text={l.say ?? l.en} clip={clipOfLine(test, u.n, k, l)} accent={profile!.accent} />
                  <p className="en small"><b>{(u as Part).cast[l.who].name}:</b> <Hl text={l.en} marks={u.groups.flatMap((g) => g.items.map((it) => it.at))} /></p>
                </div>
              ))}</div>)}
        </div>
      ))}
    </Overlay>
  )
}

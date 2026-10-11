// 首次使用：目标 → 每天时间 → 定级（词汇量快测，或手动选）→ 起点报告
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import { loadContent } from '../lib/content'
import { buildItems, manualPlacement, scorePlacement, shouldStop, type Answer, type Item, type PlacementResult } from '../lib/placement'
import { CEFR, SCENES, cefrFromIelts, eta, goalLabel, ieltsLabel, type Cefr, type Goal } from '../lib/levels'
import { db } from '../lib/db'
import type { Profile } from '../lib/lesson'
import { resetVocabState } from '../lib/calibrate'
import { currentLevel } from '../lib/progress'

type Stage = 'welcome' | 'goal' | 'minutes' | 'place' | 'quiz' | 'manual' | 'report'
const IELTS = [5, 5.5, 6, 6.5, 7, 7.5, 8]
const MINUTES = [{ m: 10, t: '10 分钟', d: '先养成习惯' }, { m: 20, t: '20 分钟', d: '推荐' }, { m: 30, t: '30 分钟', d: '稳步提升' }, { m: 45, t: '45 分钟', d: '冲刺备考' }]

export function Onboarding({ redo, onExit }: { redo?: 'goal' | 'place'; onExit?: () => void }) {
  const { setProfile, profile } = useApp()
  const [stage, setStage] = useState<Stage>(redo === 'goal' ? 'goal' : redo === 'place' ? 'place' : 'welcome')
  const [goal, setGoal] = useState<Goal | null>(profile?.goal ?? null)
  const [minutes, setMinutes] = useState(profile?.minutes ?? 20)
  const [result, setResult] = useState<PlacementResult | null>(null)

  const [prev, setPrev] = useState<number | null>(null)
  useEffect(() => { if (profile && redo === 'place') currentLevel(profile).then((l) => setPrev(l.vocab)) }, [])
  const finish = async (placement: PlacementResult) => {
    const isPlace = placement !== profile?.placement
    // 起点（进度条从这里算）：刚开始几天内重测算重新起步；之后重测保留最初的起点，进度才连贯
    const fresh = !profile || Date.now() - profile.createdAt < 3 * 86400_000
    const p: Profile = {
      goal: goal!, minutes, accent: profile?.accent ?? 'us', start: fresh ? placement.cefr : profile!.start, placement, createdAt: profile?.createdAt ?? Date.now(),
    }
    if (isPlace) await resetVocabState(p)
    if (isPlace) await db.run('INSERT INTO level_estimate(skill, cefr, value, se, source, ts, detail) VALUES (?,?,?,?,?,?,?)', ['vocab', placement.cefr, placement.vocab, null, placement.answered ? 'placement' : 'manual', Date.now(), JSON.stringify(placement.bands)])
    await setProfile(p)
    onExit?.()
  }
  // 从设置 / 今天进来的“改目标”“重测”：随时可以退回去，不改任何东西
  const back = redo && profile && onExit ? <button className="btn ghost small onb-back" onClick={onExit}>取消</button> : null

  if (stage === 'welcome') return (
    <div className="onb fade-in">
      <div className="onb-body" style={{ textAlign: 'center' }}>
        <img className="hero-logo" src="./icon-192.png" alt="" />
        <h1>每天开口，<br />把英语说出来</h1>
        <p className="lead">先花 3 分钟告诉我你的目标、测一下现在的水平，<br />之后每天的练习都从你的水平开始。</p>
      </div>
      <div className="onb-foot"><button className="btn primary block" onClick={() => setStage('goal')}>开始</button></div>
    </div>
  )

  if (stage === 'goal') return (
    <div className="onb fade-in">
      <div className="onb-body">
        {back}
        <h1>你的目标是？</h1>
        <p className="lead">之后可以随时改。</p>
        <p className="section-title" style={{ marginTop: 0 }}>考雅思</p>
        <div className="options cols-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {IELTS.map((b) => (
            <button key={b} className="opt" style={{ textAlign: 'center' }} aria-pressed={goal?.kind === 'ielts' && goal.ielts === b} onClick={() => setGoal({ kind: 'ielts', ielts: b, target: cefrFromIelts(b) })}>
              <b>{b.toFixed(1)}</b><span>{cefrFromIelts(b)}</span>
            </button>
          ))}
        </div>
        <p className="section-title">或者为了</p>
        <div className="options">
          {SCENES.map((s) => (
            <button key={s.id} className="opt" aria-pressed={goal?.kind === 'scene' && goal.scene === s.id} onClick={() => setGoal({ kind: 'scene', scene: s.id, target: s.target })}>
              <b>{s.label}</b><span>大约 {s.target}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="onb-foot">
        <button className="btn primary block" disabled={!goal} onClick={() => setStage(redo === 'goal' ? 'minutes' : 'minutes')}>下一步</button>
      </div>
    </div>
  )

  if (stage === 'minutes') return (
    <div className="onb fade-in">
      <div className="onb-body">
        {back}
        <h1>每天能练多久？</h1>
        <p className="lead">按这个时间排每天的量。哪天忙，点“保底”做 2 分钟也算数。</p>
        <div className="options cols-2">
          {MINUTES.map((x) => (
            <button key={x.m} className="opt" aria-pressed={minutes === x.m} onClick={() => setMinutes(x.m)}><b>{x.t}</b><span>{x.d}</span></button>
          ))}
        </div>
      </div>
      <div className="onb-foot">
        {redo === 'goal' && profile ? (
          <button className="btn primary block" onClick={() => finish(profile.placement)}>保存</button>
        ) : (
          <button className="btn primary block" onClick={() => setStage('place')}>下一步</button>
        )}
      </div>
    </div>
  )

  if (stage === 'place') return (
    <div className="onb fade-in">
      <div className="onb-body">
        {back}
        <h1>测一下现在的水平</h1>
        <p className="lead">约 3 分钟：一个个看单词，<b>看到就知道意思</b>才点“认识”。里面混了一些<b>假词</b>，乱点会被看出来。</p>
        <div className="card">
          <p className="small muted">测的是词汇量，它和整体水平关系最紧。听力、口语之后会在每天的练习里自动校准，不靠一次测试定终身。</p>
        </div>
      </div>
      <div className="onb-foot">
        <button className="btn primary block" onClick={() => setStage('quiz')}>开始测</button>
        <button className="btn ghost block" onClick={() => setStage('manual')}>跳过，我自己选水平</button>
      </div>
    </div>
  )

  if (stage === 'manual') return (
    <ManualPick onPick={(c) => { const r = manualPlacement(c); setResult(r); setStage('report') }} />
  )

  if (stage === 'quiz') return <Quiz onDone={(r) => { setResult(r); setStage('report') }} />

  return <Report goal={goal!} minutes={minutes} r={result!} prev={prev} onStart={() => finish(result!)} onRetry={() => setStage('quiz')} />
}

function ManualPick({ onPick }: { onPick: (c: Cefr) => void }) {
  const [c, setC] = useState<Cefr | null>(null)
  const desc: Record<Cefr, string> = {
    'Pre-A1': '几乎从零开始', A1: '认识一些简单词，能看懂很短的句子', A2: '能应付简单的日常对话和阅读', B1: '能看懂一般文章，表达还比较吃力',
    B2: '能看懂大部分内容，能比较流利地交流', C1: '能处理复杂内容，表达灵活准确', C2: '接近母语水平',
  }
  return (
    <div className="onb fade-in">
      <div className="onb-body">
        <h1>你现在大概在哪？</h1>
        <p className="lead">选个大概就行，之后会根据你的练习自动校准。</p>
        <div className="options">
          {CEFR.map((x) => <button key={x} className="opt" aria-pressed={c === x} onClick={() => setC(x)}><b>{x}</b><span>{desc[x]}</span></button>)}
        </div>
      </div>
      <div className="onb-foot"><button className="btn primary block" disabled={!c} onClick={() => onPick(c!)}>确定</button></div>
    </div>
  )
}

function Quiz({ onDone }: { onDone: (r: PlacementResult) => void }) {
  const [bands, setBands] = useState<Item[][] | null>(null)
  const [bi, setBi] = useState(0)
  const [ii, setIi] = useState(0)
  const answers = useRef<Answer[]>([])
  const shown = useRef(performance.now())
  useEffect(() => {
    Promise.all([loadContent(), fetch('./content/pseudo.json').then((r) => r.json())]).then(([c, pseudo]) => {
      // 功能词太基础，测不出东西
      setBands(buildItems(c.words, pseudo, new Set(['the', 'be', 'and', 'of', 'a', 'in', 'to', 'it', 'is'])))
    })
  }, [])
  const total = useMemo(() => bands?.reduce((s, b) => s + b.length, 0) ?? 1, [bands])
  if (!bands) return <div className="loading">准备题目…</div>
  const item = bands[bi][ii]
  const doneCount = bands.slice(0, bi).reduce((s, b) => s + b.length, 0) + ii

  const answer = (yes: boolean) => {
    answers.current.push({ item, yes, ms: Math.round(performance.now() - shown.current) })
    shown.current = performance.now()
    if (ii + 1 < bands[bi].length) { setIi(ii + 1); return }
    if (bi + 1 < bands.length && !shouldStop(answers.current)) { setBi(bi + 1); setIi(0); return }
    onDone(scorePlacement(answers.current))
  }
  return (
    <div className="onb">
      <div className="bar thin"><i style={{ width: `${(doneCount / total) * 100}%` }} /></div>
      <div className="onb-body">
        <div className="quiz-word en" key={item.text}>{item.text}</div>
        <p className="quiz-hint">看到就知道意思吗？</p>
      </div>
      <div className="yn">
        <button className="btn" onClick={() => answer(false)}>不认识</button>
        <button className="btn primary" onClick={() => answer(true)}>认识</button>
      </div>
      <p className="quiz-hint" style={{ marginTop: 12 }}>第 {bi + 1} 组，共 {bands.length} 组 · 不确定就点“不认识”</p>
    </div>
  )
}

function Report({ goal, minutes, r, prev, onStart, onRetry }: { goal: Goal; minutes: number; r: PlacementResult; prev: number | null; onStart: () => void; onRetry: () => void }) {
  const e = eta(r.cefr, goal.target, minutes)
  const reached = e.hoursLeft === 0
  return (
    <div className="onb fade-in">
      <div className="onb-body">
        <h1>你的起点</h1>
        <div className="card raised" style={{ marginTop: 12 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="report-level">{r.cefr}</div>
            <div className="spacer" />
            <div style={{ textAlign: 'right' }}><b>约 {r.vocab.toLocaleString()} 词</b><p className="small muted">雅思参考 {ieltsLabel(r.cefr)}</p></div>
          </div>
          <p className="small faint" style={{ marginTop: 6 }}>按词汇量估算 · 之后随练习自动校准</p>
          {prev !== null && <p className="small" style={{ marginTop: 6 }}>重测前估计约 {prev.toLocaleString()} 词，这次 {r.vocab >= prev ? '多了' : '少了'} <b>{Math.abs(r.vocab - prev).toLocaleString()}</b>{r.vocab < prev ? '（状态不好也会这样，不急着下结论）' : ''}</p>}
          {r.bands.length > 0 && (
            <div className="bands">
              <p className="small muted" style={{ marginBottom: 2 }}>按常用程度分组，每组认识多少</p>
              {r.bands.map((b, i) => (
                <div className="band" key={i}><span>{b.from === 1 ? '最常用 500' : `${b.from - 1 >= 1000 ? (b.from - 1) / 1000 + 'k' : b.from - 1}–${b.to >= 1000 ? b.to / 1000 + 'k' : b.to}`}</span><div className="bar"><i style={{ width: `${b.known * 100}%` }} /></div><span className="num">{Math.round(b.known * 100)}%</span></div>
              ))}
            </div>
          )}
          {r.falseAlarm >= 0.3 && <p className="small" style={{ color: 'var(--warn)', marginTop: 12 }}>假词点了不少“认识”，结果可能偏高。可以重测一次。</p>}
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <p className="muted small">目标</p>
          <b>{goalLabel(goal)}（{goal.target}）</b>
          {reached ? (
            <p className="small muted" style={{ marginTop: 6 }}>按词汇量你已经到了，接下来重点练听说和发音。</p>
          ) : (
            <p className="small muted" style={{ marginTop: 6 }}>还需要约 {e.hoursLeft} 小时的学习，按每天 {minutes} 分钟，预计 <b style={{ color: 'var(--ink)' }}>{e.date}</b> 左右到达。练得多会提前。</p>
          )}
        </div>
      </div>
      <div className="onb-foot">
        <button className="btn primary block" onClick={onStart}>{prev !== null ? '用这个结果' : '开始今天的练习'}</button>
        {r.answered > 0 && <button className="btn ghost block" onClick={onRetry}>重测一次</button>}
      </div>
    </div>
  )
}

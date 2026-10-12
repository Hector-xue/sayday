// 雅思口语模考：考官（系统语音）提问 → 你回答（本机录音、识别）→ 全部答完出报告
// 每段回答答完就在后台处理（识别 + 流利度 + 发音），不耽误下一题
import { useEffect, useRef, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { Icon } from '../components/icons'
import { useApp } from '../store'
import { buildTest, gradeWithAi, loadBank, objectiveBands, saveTest, type Answer, type Grade, type Q } from '../lib/ielts'
import { fluency, fluencyNote, segments } from '../lib/fluency'
import { ASR_MB, asrCached, ensureAsr, onAsrStatus, transcribe, type AsrStatus } from '../lib/speech/asr'
import { cancelRecording, infer, startRecording, stopRecording } from '../lib/speech/engine'
import { useMicLevel } from '../components/motion'
import { score } from '../lib/speech/score'
import { speak, stopSpeak } from '../lib/speak'
import { AiError, getAi, type AiConfig } from '../lib/ai'
import { markDay } from '../lib/lesson'

const PART_ZH = { 1: '第一部分 · 日常问答', 2: '第二部分 · 话题陈述', 3: '第三部分 · 深入讨论' }

/** 一段回答的后台处理：切段识别 → 流利度 → 前 2 段打发音分 */
async function process(q: Q, audio: Float32Array): Promise<Answer> {
  const segs = segments(audio, 20)
  const texts: string[] = []
  const prons: number[] = []
  for (let k = 0; k < segs.length; k++) {
    const piece = audio.subarray(segs[k][0], segs[k][1])
    const t = await transcribe(piece)
    texts.push(t)
    if (k < 2 && t.split(/\s+/).length >= 3) {
      try { prons.push((await score(t, await infer(piece))).score) } catch { /* 打分失败不影响识别 */ }
    }
  }
  const transcript = texts.join(' ').replace(/\s+/g, ' ').trim()
  return { q, transcript, fluency: fluency(audio, transcript), pron: prons.length ? Math.round(prons.reduce((a, b) => a + b, 0) / prons.length) : null }
}

export function Speaking({ onClose, onSetupAi }: { onClose: () => void; onSetupAi: () => void }) {
  const { profile, refresh } = useApp()
  const accent = profile!.accent
  const [qs, setQs] = useState<Q[] | null>(null)
  const [i, setI] = useState(-1)
  const [phase, setPhase] = useState<'ask' | 'prep' | 'rec' | 'idle'>('idle')
  const lv = useMicLevel(phase === 'rec')
  const [left, setLeft] = useState(0)
  const [asr, setAsr] = useState<AsrStatus>({ state: 'idle' })
  const [cached, setCached] = useState<boolean | null>(null)
  const [cfg, setCfg] = useState<AiConfig | null>(null)
  const [done, setDone] = useState(0)
  const [report, setReport] = useState<null | { answers: Answer[]; grade: Grade | null; objective: ReturnType<typeof objectiveBands>; err?: string }>(null)
  const jobs = useRef<Promise<Answer>[]>([])
  const timer = useRef<number>(0)
  const recOn = useRef(false)
  const started = useRef(performance.now())

  useEffect(() => {
    loadBank().then((b) => setQs(buildTest(b)))
    asrCached().then(setCached)
    getAi().then(setCfg)
    const off = onAsrStatus(setAsr)
    return () => { off(); clearInterval(timer.current); stopSpeak(); if (recOn.current) cancelRecording(); markDay({ seconds: (performance.now() - started.current) / 1000 }) }
  }, [])

  const q = qs && i >= 0 ? qs[i] : null
  const countdown = (sec: number, then: () => void) => {
    clearInterval(timer.current)
    setLeft(sec)
    const end = Date.now() + sec * 1000
    timer.current = window.setInterval(() => {
      const l = Math.ceil((end - Date.now()) / 1000)
      setLeft(Math.max(0, l))
      if (l <= 0) { clearInterval(timer.current); then() }
    }, 250)
  }
  const ask = async (k: number) => {
    setI(k); setPhase('ask')
    const qq = qs![k]
    try { await speak(qq.part === 2 ? `Now I'm going to give you a topic. ${qq.text} You have one minute to prepare.` : qq.text, 'gb', 0.95) } catch { /* 没有语音也能看文字 */ }
    if (qq.part === 2) { setPhase('prep'); countdown(60, () => record(k)) } else record(k)
  }
  const record = async (k: number) => {
    clearInterval(timer.current)
    try { await startRecording(); recOn.current = true } catch (e) { alert('用不了麦克风：' + ((e as Error).message || e)); return }
    setPhase('rec')
    countdown(qs![k].maxSec, () => finish(k))
  }
  const finish = async (k: number) => {
    clearInterval(timer.current)
    if (!recOn.current) return
    recOn.current = false
    const audio = await stopRecording()
    const job = process(qs![k], audio)
    jobs.current[k] = job
    job.then(() => setDone((x) => x + 1)).catch(() => setDone((x) => x + 1))
    if (k + 1 < qs!.length) ask(k + 1)
    else { setPhase('idle'); setI(qs!.length) }
  }
  // 全部答完：等后台处理完 → 有 AI 就评分
  useEffect(() => {
    if (!qs || i !== qs.length || report) return
    ;(async () => {
      const answers = (await Promise.allSettled(jobs.current)).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      const objective = objectiveBands(answers)
      let grade: Grade | null = null, err: string | undefined
      if (cfg && answers.some((a) => a.transcript)) {
        try { grade = await gradeWithAi(cfg, answers) } catch (e) { err = e instanceof AiError ? e.message : String((e as Error).message || e) }
      }
      await saveTest(answers, grade, objective)
      setReport({ answers, grade, objective, err })
      refresh()
    })()
  }, [i, qs])

  // ---- 开始前 ----
  if (i < 0) return (
    <Overlay title="雅思口语模考" sub="约 12 分钟 · 三个部分" onClose={onClose} foot={
      <button className="btn primary block" disabled={!qs || asr.state === 'loading'} onClick={async () => {
        if (!cached && asr.state !== 'ready' && !confirm(`要先下载一个约 ${ASR_MB}MB 的语音识别模型（只下一次，录音不上传）。现在下载？`)) return
        try { await ensureAsr() } catch (e) { alert('识别模型载入失败：' + ((e as Error).message || e)); return }
        ask(0)
      }}>{asr.state === 'loading' ? `下载识别模型 ${asr.total ? Math.round(((asr.got ?? 0) / asr.total) * 100) : 0}%` : '开始'}</button>
    }>
      <div className="fade-in">
        <ol className="tips" style={{ background: 'none', padding: 0 }}>
          <li><b>第一部分</b>两个日常话题，6 个问题，每题 45 秒内</li>
          <li><b>第二部分</b>一张话题卡，准备 1 分钟，说 1~2 分钟</li>
          <li><b>第三部分</b>围绕话题的 3 个讨论题</li>
        </ol>
        <p className="small muted" style={{ marginTop: 12 }}>考官用英音提问（系统语音）。录音只在本机识别和打分，不上传。</p>
        <div className="card" style={{ marginTop: 14 }}>
          {cfg ? <p className="small">答完后由你接入的 AI（{cfg.model}）按雅思四项标准评分：流利连贯、词汇、语法、发音。</p>
            : <div className="row" style={{ gap: 12 }}><p className="small" style={{ flex: 1 }}>没接入 AI：只能给出<b>流利度</b>和<b>发音</b>两项的客观参考；接入后按雅思四项标准评分。</p><button className="btn small quiet" onClick={onSetupAi}>接入 AI</button></div>}
        </div>
        <p className="small faint" style={{ marginTop: 12 }}>题目为日日说原创的雅思风格练习题，不是真题；分数是练习参考。</p>
      </div>
    </Overlay>
  )

  // ---- 报告 ----
  if (!qs || i >= qs.length) {
    if (!report) return <Overlay title="雅思口语模考" onClose={onClose}><div className="loading">正在整理你的回答（识别 {done}/{qs?.length ?? 0}）{cfg ? '，然后请 AI 评分' : ''}…</div></Overlay>
    const g = report.grade, o = report.objective
    const rows: [string, number | null][] = g ? [['流利连贯', g.fc], ['词汇', g.lr], ['语法', g.gra], ['发音', g.p]] : [['流利连贯（参考）', o.fc], ['发音（参考）', o.p]]
    return (
      <Overlay title="模考报告" onClose={onClose} foot={<button className="btn primary block" onClick={onClose}>好的</button>}>
        <div className="fade-in">
          <div className="card raised" style={{ textAlign: 'center' }}>
            <p className="small muted">{g ? '总分（AI 评估）' : '没接 AI，只有两项参考'}</p>
            <div className="report-level" style={{ fontSize: 56 }}>{g ? g.overall.toFixed(1) : '—'}</div>
            <div className="band-rows">{rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{v === null ? '—' : v.toFixed(1)}</b></div>)}</div>
            {g && <p style={{ marginTop: 12, textAlign: 'left' }}>{g.summary}</p>}
            {report.err && <div className="err-box" style={{ textAlign: 'left' }}>AI 评分失败：{report.err}</div>}
          </div>
          {g && g.tips.length > 0 && <><p className="section-title">最该改的</p><ul className="tips">{g.tips.map((t) => <li key={t}>{t}</li>)}</ul></>}
          {g?.better && (
            <>
              <p className="section-title">参考回答（7 分水平）</p>
              <div className="card"><p className="small muted">{g.better.q}</p><p className="en" style={{ marginTop: 6, fontSize: 17 }}>{g.better.answer}</p>
                <button className="btn small quiet" style={{ marginTop: 10 }} onClick={() => speak(g.better!.answer, accent).catch(() => {})}>听一遍</button></div>
            </>
          )}
          <p className="section-title">你的回答（本机识别）</p>
          <div className="list">
            {report.answers.map((a, k) => (
              <div className="edit" key={k}>
                <p className="small muted">P{a.q.part} · {a.q.text}</p>
                <p className="en" style={{ marginTop: 4 }}>{a.transcript || <span className="faint">（没识别出内容）</span>}</p>
                <p className="small faint" style={{ marginTop: 4 }}>{fluencyNote(a.fluency)}{a.pron !== null ? ` · 发音 ${a.pron} 分` : ''}</p>
              </div>
            ))}
          </div>
          <p className="small faint" style={{ margin: '14px 4px' }}>识别是本机离线做的，口音重或说得快时会有错字；评分仅供练习参考。</p>
        </div>
      </Overlay>
    )
  }

  // ---- 答题中 ----
  return (
    <Overlay title={PART_ZH[q!.part]} sub={`${i + 1}/${qs.length}`} onClose={() => { if (confirm('退出模考？这次的回答不会保存。')) onClose() }}
      foot={phase === 'rec' ? <button className="btn primary block" onClick={() => finish(i)}>说完了（{left} 秒）</button>
        : phase === 'prep' ? <button className="btn primary block" onClick={() => record(i)}>准备好了，开始说（{left} 秒）</button>
        : <button className="btn quiet block" disabled>考官提问中…</button>}>
      <div className="fade-in" key={i}>
        {q!.part === 2 && q!.card ? (
          <div className="card raised cue">
            <p className="en" style={{ fontSize: 19, fontWeight: 600 }}>{q!.card.card}</p>
            <p className="small muted">{q!.card.card_zh}</p>
            <p className="small" style={{ marginTop: 10 }}>You should say:</p>
            <ul className="en">{q!.card.points.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        ) : (
          <div className="examiner">
            <span className="ex-ico"><Icon.ear /></span>
            <p className="en">{q!.text}</p>
          </div>
        )}
        <div className="rec-zone" style={{ marginTop: 28 }}>
          <div className={`rec-btn ${phase === 'rec' ? 'on' : ''}`} style={{ ['--lv' as string]: lv }} aria-hidden>{phase === 'rec' ? <Icon.mic /> : <Icon.ear />}</div>
          <div className="rec-label">{phase === 'rec' ? '正在听你说…说完点下面的按钮' : phase === 'prep' ? `准备时间，可以在脑子里列个提纲（剩 ${left} 秒）` : '听问题'}</div>
        </div>
        {phase === 'rec' && <p className="small faint" style={{ textAlign: 'center' }}>{q!.part === 2 ? '尽量说满 1 分钟以上' : '两三句话、带一个理由或例子就好'}</p>}
      </div>
    </Overlay>
  )
}

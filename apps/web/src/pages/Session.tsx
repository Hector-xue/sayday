// 一组练习：复习 → 新词 → 跟读。每一步做完就入库（中途退出不丢进度）
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../components/icons'
import { PlayButton } from '../components/PlayButton'
import { Shadow } from '../components/Shadow'
import { buildSession, markDay, saveAttempt, type Step } from '../lib/lesson'
import { addCard, grade, preview, Rating } from '../lib/srs'
import { prefetch } from '../lib/tts'
import type { Sentence } from '../lib/content'

function Example({ s, word, showZh = true }: { s?: Sentence; word: string; showZh?: boolean }) {
  if (!s) return null
  const parts = s.en.split(new RegExp(`\\b(${word}\\w*)`, 'i'))
  return (
    <div className="example">
      <p className="en">{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</p>
      {showZh && <p className="zh">{s.zh}</p>}
    </div>
  )
}

export function Session({ minimum, onClose }: { minimum: boolean; onClose: () => void }) {
  const { profile, refresh, toast } = useApp()
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [i, setI] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [ivals, setIvals] = useState<Record<number, string>>({})
  const [scored, setScored] = useState(false)
  const started = useRef(performance.now())
  const doneSteps = useRef(0)
  const stepStart = useRef(performance.now())
  const accent = profile!.accent

  useEffect(() => {
    buildSession(profile!, minimum).then((s) => {
      setSteps(s)
      // 后台提前合成示范读音：先跟读句，再例句
      const clips = [
        ...s.flatMap((x) => (x.kind === 'shadow' ? [{ text: x.sentence.en, sentenceId: x.sentence.id }] : [])),
        ...s.flatMap((x) => (x.kind !== 'shadow' ? [{ text: x.word.w, word: x.word.w }, ...(x.sentence ? [{ text: x.sentence.en, sentenceId: x.sentence.id }] : [])] : [])),
      ]
      prefetch(clips, accent)
    })
    return () => { markDay({ seconds: (performance.now() - started.current) / 1000 }) }
  }, [])

  const step = steps?.[i]
  useEffect(() => {
    setRevealed(false); setScored(false); stepStart.current = performance.now()
    if (step?.kind === 'review') preview(step.word.w).then(setIvals)
  }, [i, step])

  if (!steps) return <div className="session"><div className="loading">排今天的内容…</div></div>
  const finish = async () => {
    // 保底：至少做完一步才算今天“做了”；一步没做就关掉不记
    if (minimum && doneSteps.current > 0) await markDay({ minimum: true, done: true })
    if (!minimum && doneSteps.current > 0) {
      const rest = await buildSession(profile!, false)
      if (!rest.length) await markDay({ done: true })
    }
    refresh()
    onClose()
  }
  const next = (completed = true) => { if (completed) doneSteps.current++; setI(i + 1 < steps.length ? i + 1 : steps.length) }

  if (!step) return (
    <div className="session">
      <div className="session-body" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div className="fade-in">
          <div style={{ fontSize: 48 }} aria-hidden>{steps.length ? '🌱' : '☕'}</div>
          <h2 style={{ margin: '12px 0 8px' }}>{steps.length ? '这一组完成了' : '今天的量已经做完了'}</h2>
          <p className="muted">{steps.length ? `复习 ${steps.filter((s) => s.kind === 'review').length} · 新词 ${steps.filter((s) => s.kind === 'learn').length} · 跟读 ${steps.filter((s) => s.kind === 'shadow').length}` : '明天到期的词会自动排好。'}</p>
        </div>
      </div>
      <div className="session-foot"><button className="btn primary block" onClick={finish}>好的</button></div>
    </div>
  )

  const doGrade = async (r: Rating) => {
    if (step.kind !== 'review') return
    await grade(step.word.w, r as any, Math.round(performance.now() - stepStart.current))
    next()
  }
  const learn = async (known: boolean) => {
    if (step.kind !== 'learn') return
    await addCard(step.word.w, known)
    if (!known) await markDay({ new_words: 1 })
    next()
  }

  return (
    <div className="session">
      <div className="session-top">
        <button className="icon-btn" onClick={finish} aria-label="结束"><Icon.close /></button>
        <div className="bar"><i style={{ width: `${(i / steps.length) * 100}%` }} /></div>
        <span className="small muted">{i + 1}/{steps.length}</span>
      </div>

      <div className="session-body" key={i}>
        {step.kind === 'review' && (
          <div className="fade-in">
            <p className="step-kind">复习 · 还记得意思吗？</p>
            <div className="row"><div className="word-big">{step.word.w}</div><div className="spacer" /><PlayButton text={step.word.w} clip={{ text: step.word.w, word: step.word.w }} accent={accent} /></div>
            {revealed ? (
              <>
                <p className="ipa">/{step.word.ipa}/</p>
                <p className="zh-mean">{step.word.zh}</p>
                <Example s={step.sentence} word={step.word.w} />
                {step.sentence && <div className="row" style={{ marginTop: 12 }}><PlayButton text={step.sentence.en} clip={{ text: step.sentence.en, sentenceId: step.sentence.id }} accent={accent} label="听例句" /><span className="small muted">听例句</span></div>}
              </>
            ) : (
              <>
                <Example s={step.sentence} word={step.word.w} showZh={false} />
                <p className="reveal-hint">先在心里想一下，再看答案</p>
              </>
            )}
          </div>
        )}

        {step.kind === 'learn' && (
          <div className="fade-in">
            <p className="step-kind">新词{step.word.tags.includes('ielts') ? ' · 雅思词汇' : ''}</p>
            <div className="row"><div className="word-big">{step.word.w}</div><div className="spacer" /><PlayButton text={step.word.w} clip={{ text: step.word.w, word: step.word.w }} accent={accent} /></div>
            <p className="ipa">/{step.word.ipa}/</p>
            <p className="zh-mean">{step.word.zh}</p>
            <Example s={step.sentence} word={step.word.w} />
            {step.sentence && <div className="row" style={{ marginTop: 12 }}><PlayButton text={step.sentence.en} clip={{ text: step.sentence.en, sentenceId: step.sentence.id }} accent={accent} label="听例句" /><span className="small muted">听例句</span></div>}
          </div>
        )}

        {step.kind === 'shadow' && (
          <div className="fade-in">
            <p className="step-kind">跟读</p>
            <p className="shadow-sentence en">{step.sentence.en}</p>
            <p className="shadow-zh">{step.sentence.zh}</p>
            <Shadow text={step.sentence.en} sentenceId={step.sentence.id} accent={accent} onScored={async (r) => {
              const phones = r.words.flatMap((w) => w.phones.map((p) => [p.p, +p.s.toFixed(2)] as [string, number]))
              await saveAttempt(step.sentence.id, step.sentence.en, r.score, phones, r.words.filter((w) => w.tail).map((w) => `${w.word}:${w.tail}`))
              if (!scored) { await markDay({ shadows: 1 }); setScored(true) }
            }} />
          </div>
        )}
      </div>

      <div className="session-foot">
        {step.kind === 'review' && (revealed ? (
          <div className="grade">
            <button className="again" onClick={() => doGrade(Rating.Again)}>忘了<small>{ivals[Rating.Again]}</small></button>
            <button onClick={() => doGrade(Rating.Hard)}>模糊<small>{ivals[Rating.Hard]}</small></button>
            <button className="good" onClick={() => doGrade(Rating.Good)}>记得<small>{ivals[Rating.Good]}</small></button>
            <button onClick={() => doGrade(Rating.Easy)}>简单<small>{ivals[Rating.Easy]}</small></button>
          </div>
        ) : <button className="btn primary block" onClick={() => setRevealed(true)}>看答案</button>)}
        {step.kind === 'learn' && (
          <div className="row">
            <button className="btn quiet" style={{ flex: 1 }} onClick={() => learn(true)}>早就认识</button>
            <button className="btn primary" style={{ flex: 2 }} onClick={() => learn(false)}>记下了</button>
          </div>
        )}
        {step.kind === 'shadow' && (
          <div className="row">
            <button className="btn quiet" style={{ flex: 1 }} onClick={() => { toast('跳过了这句'); next(false) }}>跳过</button>
            <button className="btn primary" style={{ flex: 2 }} disabled={!scored} onClick={() => next()}>下一句</button>
          </div>
        )}
      </div>
    </div>
  )
}

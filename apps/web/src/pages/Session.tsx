// 一组练习：复习 → 新词 → 跟读。每一步做完就入库（中途退出不丢进度）
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../components/icons'
import { PlayButton } from '../components/PlayButton'
import { HINT, Shadow } from '../components/Shadow'
import { ipa } from '../lib/phones'
import { LINE_PASS, reviewLine } from '../lib/episodes'
import { buildSession, markDay, saveAttempt, saveRecording, type Step } from '../lib/lesson'
import { applyCheck, saveListen, type CheckItem } from '../lib/calibrate'
import type { Answer } from '../lib/placement'
import { addCard, grade, preview, Rating } from '../lib/srs'
import { prefetch } from '../lib/tts'
import type { Sentence } from '../lib/content'
import { SpellCard } from '../components/SpellCard'
import { getClips, markWord, type Clip } from '../lib/clips'
import { Tappable } from '../components/Tappable'

function Example({ s, word, showZh = true }: { s?: Sentence; word: string; showZh?: boolean }) {
  if (!s) return null
  return (
    <div className="example">
      <p className="en"><Tappable text={s.en} highlight={word} /></p>
      {showZh && <p className="zh">{s.zh}</p>}
    </div>
  )
}

export function Session({ minimum, comeback, onClose }: { minimum: boolean; comeback?: boolean; onClose: () => void }) {
  const { profile, refresh, toast } = useApp()
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [i, setI] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [ivals, setIvals] = useState<Record<number, string>>({})
  const [scored, setScored] = useState(false)
  const started = useRef(performance.now())
  const doneSteps = useRef(0)
  const linePassed = useRef(new Set<number>())
  const [clips, setClips] = useState<Record<string, Clip>>({})
  useEffect(() => { getClips().then(setClips).catch(() => {}) }, [])
  const clipOf = (w: string) => clips[w] && <SeenOnWeb c={clips[w]} word={w} />
  const stepStart = useRef(performance.now())
  const accent = profile!.accent

  useEffect(() => {
    buildSession(profile!, minimum, comeback).then((s) => {
      setSteps(s)
      // 后台提前合成示范读音：先跟读句，再例句
      const clips = [
        ...s.flatMap((x) => (x.kind === 'shadow' && x.line ? [x.line.clip] : x.kind === 'shadow' || x.kind === 'listen' ? [{ text: x.sentence.en, sentenceId: x.sentence.id }] : [])),
        ...s.flatMap((x) => (x.kind === 'learn' || x.kind === 'review' ? [{ text: x.word.w, word: x.word.w }, ...(x.sentence ? [{ text: x.sentence.en, sentenceId: x.sentence.id }] : [])] : [])),
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
    if ((minimum || comeback) && doneSteps.current > 0) await markDay({ minimum: true, done: true })
    if (!minimum && !comeback && doneSteps.current > 0) {
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
          <div className="done-mark" aria-hidden>{steps.length ? <Icon.sprout /> : <Icon.cup />}</div>
          <h2 style={{ margin: '12px 0 8px' }}>{steps.length ? '这一组完成了' : '今天的量已经做完了'}</h2>
          <p className="muted">{steps.length ? [['review', '复习'], ['spell', '拼写'], ['learn', '新词'], ['listen', '听力'], ['shadow', '跟读']].filter(([k]) => steps.some((s) => s.kind === k)).map(([k, t]) => `${t} ${steps.filter((s) => s.kind === k).length}`).join(' · ') : '明天到期的词会自动排好。'}</p>
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
                {step.word.ipa && <p className="ipa">/{step.word.ipa}/</p>}
                <p className="zh-mean">{step.word.zh}</p>
                {clipOf(step.word.w)}
                <Example s={step.sentence} word={step.word.w} />
                {step.sentence && <div className="row" style={{ marginTop: 12 }}><PlayButton text={step.sentence.en} clip={{ text: step.sentence.en, sentenceId: step.sentence.id }} accent={accent} label="听例句" /><span className="small muted">听例句</span></div>}
              </>
            ) : (
              <>
                {clipOf(step.word.w) ?? <Example s={step.sentence} word={step.word.w} showZh={false} />}
                <p className="reveal-hint">先在心里想一下，再看答案</p>
              </>
            )}
          </div>
        )}

        {step.kind === 'spell' && (
          <div className="fade-in">
            <p className="step-kind">复习 · 听音写词</p>
            <SpellCard key={i} word={step.word} accent={accent} onResult={async (r) => {
              await grade(step.word.w, (r === 'right' ? Rating.Good : r === 'close' ? Rating.Hard : Rating.Again) as any, Math.round(performance.now() - stepStart.current))
              setScored(true)
            }} />
            {scored && clipOf(step.word.w)}
            {scored && <Example s={step.sentence} word={step.word.w} />}
          </div>
        )}

        {step.kind === 'learn' && (
          <div className="fade-in">
            <p className="step-kind">新词{step.word.tags.includes('ielts') ? ' · 雅思词汇' : ''}</p>
            <div className="row"><div className="word-big">{step.word.w}</div><div className="spacer" /><PlayButton text={step.word.w} clip={{ text: step.word.w, word: step.word.w }} accent={accent} /></div>
            {step.word.ipa && <p className="ipa">/{step.word.ipa}/</p>}
            <p className="zh-mean">{step.word.zh}</p>
            <Example s={step.sentence} word={step.word.w} />
            {step.sentence && <div className="row" style={{ marginTop: 12 }}><PlayButton text={step.sentence.en} clip={{ text: step.sentence.en, sentenceId: step.sentence.id }} accent={accent} label="听例句" /><span className="small muted">听例句</span></div>}
          </div>
        )}

        {step.kind === 'check' && <WeeklyCheck items={step.items} onDone={async (answers) => {
          const r = await applyCheck(profile!, answers)
          const d = r.after - r.before
          toast(r.unreliable ? '假词点了不少“认识”，这次先不算，下周再测' : `小测完成：约 ${r.after.toLocaleString()} 词（${d >= 0 ? '+' : ''}${d}）`)
          refresh()
          next()
        }} />}

        {step.kind === 'listen' && <Listen key={step.sentence.id} step={step} accent={accent} onAnswer={async (ok) => {
          await saveListen(step.sentence.id, step.sentence.hard, step.sentence.cefr, ok)
          setScored(true)
        }} />}

        {step.kind === 'shadow' && (
          <div className="fade-in">
            <p className="step-kind">{step.phone ? <>跟读 · 专练弱项 <b>/{ipa(step.phone)}/</b></> : step.line ? `跟读 · 剧集台词（${step.line.from}）` : '跟读'}</p>
            {step.phone && HINT[step.phone] && <p className="small muted" style={{ marginTop: 2 }}>{HINT[step.phone]}</p>}
            <p className="shadow-sentence en"><Tappable text={step.sentence.en} highlight={step.focus} karaoke /></p>
            <p className="shadow-zh">{step.sentence.zh}</p>
            <Shadow key={step.sentence.id} text={step.sentence.en} sentenceId={step.line ? undefined : step.sentence.id} clip={step.line?.clip} accent={accent} onScored={async (r, audio) => {
              const phones = r.words.flatMap((w) => w.phones.map((p) => [p.p, +p.s.toFixed(2)] as [string, number]))
              const sid = step.line ? null : step.sentence.id
              await saveAttempt(sid, step.sentence.en, r.score, phones, r.words.filter((w) => w.tail).map((w) => `${w.word}:${w.tail}`))
              saveRecording(sid, step.sentence.en, r.score, audio).catch(() => {})
              // 台词复习：读好之前每次都记（没读好 = 明天再来），读好一次就往后推，之后重读不再改
              if (step.line && !linePassed.current.has(i)) {
                await reviewLine(step.line.ref, r.score)
                if (r.score >= LINE_PASS) linePassed.current.add(i)
              }
              if (!scored) { await markDay({ shadows: 1 }); setScored(true) }
            }} />
          </div>
        )}
      </div>

      <div className="session-foot">
        {step.kind === 'spell' && scored && <button className="btn primary block" onClick={() => next()}>下一个</button>}
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
        {step.kind === 'listen' && (
          <div className="row">
            {!scored && <button className="btn quiet" style={{ flex: 1 }} onClick={() => { toast('跳过了这题'); next(false) }}>跳过</button>}
            <button className="btn primary" style={{ flex: 2 }} disabled={!scored} onClick={() => next()}>下一题</button>
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

/** 听音选义：先只给声音，选对应的中文意思；选完再显示原句 */
function Listen({ step, accent, onAnswer }: { step: Extract<Step, { kind: 'listen' }>; accent: 'us' | 'gb'; onAnswer: (ok: boolean) => void }) {
  const [pick, setPick] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const s = step.sentence
  const clip = { text: s.en, sentenceId: s.id }
  return (
    <div className="fade-in">
      <p className="step-kind">听力 · 听完选意思</p>
      <div className="listen-play">
        <PlayButton text={s.en} clip={clip} accent={accent} label="播放" onError={(e) => setErr('这句的音频没下载下来：' + e.message)} />
        <PlayButton text={s.en} clip={clip} accent={accent} rate={0.75} label="慢速" />
        <span className="small muted">可以多听几遍</span>
      </div>
      {err && <p className="small" style={{ color: 'var(--warn)' }}>{err}</p>}
      <div className="options" style={{ marginTop: 18 }}>
        {step.options.map((o, k) => {
          const state = pick === null ? '' : k === step.answer ? 'right' : k === pick ? 'wrong' : 'dim'
          return (
            <button key={k} className={`opt ${state}`} disabled={pick !== null} onClick={() => { setPick(k); onAnswer(k === step.answer) }}>
              <b style={{ fontWeight: 500 }}>{o}</b>
            </button>
          )
        })}
      </div>
      {pick !== null && (
        <div className="example fade-in" style={{ marginTop: 16 }}>
          <p className="small muted">{pick === step.answer ? '答对了。原句：' : '原句是：'}</p>
          <p className="en"><Tappable text={s.en} /></p>
        </div>
      )}
    </div>
  )
}

/** 每周小测：和入门定级一样的“认识 / 不认识”，只测水平边界附近，约 1 分钟 */
function WeeklyCheck({ items, onDone }: { items: CheckItem[]; onDone: (a: Answer[]) => void }) {
  const [k, setK] = useState(-1)
  const answers = useRef<Answer[]>([])
  const shown = useRef(performance.now())
  if (k < 0) return (
    <div className="fade-in" style={{ textAlign: 'center', paddingTop: 24 }}>
      <p className="step-kind">每周小测</p>
      <h2 style={{ margin: '8px 0' }}>1 分钟，校准一下水平</h2>
      <p className="muted small">和刚开始那次一样：看到就知道意思才点“认识”，里面混了假词。<br />结果只会让每天的新词更合适，不会扣分。</p>
      <button className="btn primary" style={{ marginTop: 20 }} onClick={() => { setK(0); shown.current = performance.now() }}>开始</button>
    </div>
  )
  const it = items[k]
  const answer = (yes: boolean) => {
    answers.current.push({ item: { text: it.text, real: it.real, band: it.band }, yes, ms: Math.round(performance.now() - shown.current) })
    shown.current = performance.now()
    if (k + 1 < items.length) setK(k + 1)
    else onDone(answers.current)
  }
  return (
    <div>
      <p className="step-kind">每周小测 · {k + 1}/{items.length}</p>
      <div className="quiz-word en" key={it.text}>{it.text}</div>
      <div className="yn" style={{ marginTop: 24 }}>
        <button className="btn" onClick={() => answer(false)}>不认识</button>
        <button className="btn primary" onClick={() => answer(true)}>认识</button>
      </div>
    </div>
  )
}

/** 浏览器插件收词时的原句：“你在哪儿见过它” */
function SeenOnWeb({ c, word }: { c: Clip; word: string }) {
  const [a, w, b] = markWord(c.s, word)
  return (
    <div className="seen-web">
      <span className="small muted">你在网上见过它{c.title ? ` · ${c.title.slice(0, 24)}` : ''}</span>
      <p className="en">{a}{w && <mark>{w}</mark>}{b}</p>
    </div>
  )
}

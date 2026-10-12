// 剧集：一季十集，一天解锁一集。每集 听 → 演（你演林，逐句跟读）→ 测 → 收生词
import { useEffect, useRef, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { Icon } from '../components/icons'
import { PlayButton } from '../components/PlayButton'
import { Shadow } from '../components/Shadow'
import { Tappable } from '../components/Tappable'
import { useApp } from '../store'
import { clipOf, episodeWords, finish, getProgress, key, loadSeasons, nextUp, teaserFor, unlocked, type EpProgress, type Episode, type Season } from '../lib/episodes'
import { play, prefetch, stopAudio } from '../lib/tts'
import { addCard } from '../lib/srs'
import { db } from '../lib/db'
import { markDay, saveAttempt } from '../lib/lesson'
import { vocabLevel } from '../lib/calibrate'
import type { Word } from '../lib/content'

export function Episodes({ openId, onOpened }: { openId?: { season: number; ep: number } | null; onOpened?: () => void }) {
  const { tick } = useApp()
  const [all, setAll] = useState<Season[] | null>(null)
  const [p, setP] = useState<EpProgress | null>(null)
  const [open, setOpen] = useState<{ s: Season; ep: Episode } | null>(null)
  const [tab, setTab] = useState<number | null>(null)
  useEffect(() => { loadSeasons().then(setAll); getProgress().then(setP) }, [tick, open])
  useEffect(() => {
    if (!all || !openId) return
    const s = all.find((x) => x.season === openId.season)
    const e = s?.episodes.find((x) => x.id === openId.ep)
    if (s && e) setOpen({ s, ep: e })
    onOpened?.()
  }, [all, openId])
  if (!all || !p) return <div className="loading">…</div>
  const up = nextUp(all, p)
  const cur = all.find((s) => s.season === (tab ?? up.season.season)) ?? all[0]
  return (
    <div className="page fade-in">
      <div className="page-head"><h1>剧集</h1><span className="small muted">第 {up.season.season} 季 · {up.season.title}</span></div>
      <div className="card raised ep-hero">
        {up.state !== 'all-done' && (
          <div className="poster" aria-hidden>
            <span className="poster-no">{String(up.ep.id).padStart(2, '0')}</span>
            <span className="poster-s">S{up.season.season} · {up.ep.level}</span>
            {up.state === 'ready' && up.ep.lines[0] && <p className="poster-quote en">“{up.ep.lines[0].en}”<small>— {up.ep.lines[0].who}</small></p>}
          </div>
        )}
        <p className="small muted">{up.state === 'all-done' ? '已经全部看完' : up.state === 'tomorrow' ? '明天解锁' : `第 ${up.season.season} 季 第 ${up.ep.id} 集 · ${up.ep.level}`}</p>
        <h2 className="en" style={{ margin: '6px 0 2px' }}>{up.ep.title}</h2>
        <p className="muted">{up.ep.title_zh}</p>
        <p style={{ marginTop: 10 }}>{up.state === 'tomorrow' ? teaserFor(all, up.season.season, up.ep.id) : up.state === 'all-done' ? '下一季准备中。' : up.ep.scene_zh}</p>
        {up.state === 'ready' && <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => setOpen({ s: up.season, ep: up.ep })}>开始看</button>}
      </div>
      <div className="season-head">
        {all.length > 1 && <div className="seg">{all.map((s) => <button key={s.season} aria-pressed={s.season === cur.season} onClick={() => setTab(s.season)}>第 {s.season} 季</button>)}</div>}
        <p className="section-title" style={{ margin: 0 }}>{all.length > 1 ? '' : `第 ${cur.season} 季 · `}{cur.title_zh} · {cur.episodes.length} 集</p>
      </div>
      <div className="list">
        {cur.episodes.map((e) => {
          const d = p.done[key(cur.season, e.id)]
          const ok = unlocked(all, cur.season, e.id, p)
          return (
            <button className="list-row" key={e.id} disabled={!ok} onClick={() => setOpen({ s: cur, ep: e })} style={{ opacity: ok ? 1 : 0.5 }}>
              <span className="ep-no">{d ? <Icon.check /> : e.id}</span>
              <span className="main"><b>{e.title}</b><span>{e.title_zh}{d ? ` · 理解 ${d.quiz}/${e.quiz.length}${d.act !== null ? ` · 跟读 ${d.act} 分` : ''}` : ok ? '' : ' · 看完上一集，第二天解锁'}</span></span>
            </button>
          )
        })}
      </div>
      <p className="small faint" style={{ margin: '14px 4px' }}>一天一集，像追剧一样学。人物配音为 AI 合成。</p>
      {open && <Player s={open.s} ep={open.ep} onClose={() => setOpen(null)} />}
    </div>
  )
}

type Stage = 'listen' | 'act' | 'quiz' | 'words' | 'done'

function Player({ s, ep, onClose }: { s: Season; ep: Episode; onClose: () => void }) {
  const { profile, refresh, toast } = useApp()
  const accent = profile!.accent
  const [stage, setStage] = useState<Stage>('listen')
  const [shown, setShown] = useState(1)
  const [auto, setAuto] = useState(false)
  const [zh, setZh] = useState<Set<number>>(new Set())
  const [actScores, setActScores] = useState<Record<number, number>>({})
  const [actI, setActI] = useState(0)
  const [answers, setAnswers] = useState<(number | null)[]>(ep.quiz.map(() => null))
  const [words, setWords] = useState<Word[]>([])
  const [added, setAdded] = useState<Set<string>>(new Set())
  const end = useRef<HTMLDivElement>(null)
  const started = useRef(performance.now())
  const me = Object.entries(s.cast).find(([, c]) => c.me)?.[0] ?? 'Lin'
  const myLines = ep.lines.map((l, i) => ({ l, i })).filter((x) => x.l.who === me)
  const clip = (i: number) => clipOf(s.season, ep.id, i, ep.lines[i].en)

  useEffect(() => {
    prefetch(ep.lines.map((_, i) => clip(i)), accent)
    db.all<{ word: string }>('SELECT word FROM card').then(async (r) => setWords(await episodeWords(ep, new Set(r.map((x) => x.word)), (await vocabLevel(profile!)).frontier)))
    return () => { stopAudio(); markDay({ seconds: (performance.now() - started.current) / 1000 }) }
  }, [])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [shown])

  // 自动连播：放完一句出下一句
  const autoRef = useRef(false)
  const playFrom = async (i: number) => {
    autoRef.current = true; setAuto(true)
    for (let k = i; k < ep.lines.length && autoRef.current; k++) {
      setShown((x) => Math.max(x, k + 1))
      try { await play(clip(k), accent) } catch { /* 没音频就跳过这句 */ }
      if (autoRef.current) await new Promise((r) => setTimeout(r, 350))
    }
    autoRef.current = false; setAuto(false)
  }
  const pause = () => { autoRef.current = false; setAuto(false); stopAudio() }

  const bubble = (i: number) => {
    const l = ep.lines[i]
    const mine = l.who === me
    return (
      <div key={i} className={`bubble-row ${mine ? 'user' : 'assistant'}`}>
        <span className="who small muted">{mine ? '你（林）' : s.cast[l.who]?.zh ?? l.who}</span>
        <div className={`bubble ep ${mine ? 'me' : ''}`} onClick={() => setZh((z) => { const n = new Set(z); if (n.has(i)) n.delete(i); else n.add(i); return n })}>
          <span className="en"><Tappable text={l.en} karaoke /></span>
          {zh.has(i) && <p className="bubble-zh">{l.zh}</p>}
        </div>
      </div>
    )
  }

  const quizScore = answers.filter((a, k) => a === ep.quiz[k].answer).length
  const actAvg = Object.values(actScores).length ? Math.round(Object.values(actScores).reduce((a, b) => a + b, 0) / Object.values(actScores).length) : null
  const done = async () => { await finish(s.season, ep.id, quizScore, actAvg); refresh(); setStage('done') }

  const STAGES: [Stage, string][] = [['listen', '听'], ['act', '演'], ['quiz', '测'], ['words', '词']]
  const foot = stage === 'listen' ? (
    shown < ep.lines.length
      ? <div className="row">{auto ? <button className="btn quiet" style={{ flex: 1 }} onClick={pause}>暂停</button> : <button className="btn quiet" style={{ flex: 1 }} onClick={() => playFrom(shown)}>自动连播</button>}<button className="btn primary" style={{ flex: 2 }} onClick={() => { pause(); setShown(shown + 1); play(clip(shown), accent).catch(() => {}) }}>下一句</button></div>
      : <div className="row"><button className="btn quiet" style={{ flex: 1 }} onClick={() => playFrom(0)}>从头再听</button><button className="btn primary" style={{ flex: 2 }} onClick={() => { pause(); setStage(myLines.length ? 'act' : 'quiz') }}>轮到你演林</button></div>
  ) : stage === 'act' ? (
    <div className="row"><button className="btn quiet" style={{ flex: 1 }} onClick={() => (actI + 1 < myLines.length ? setActI(actI + 1) : setStage('quiz'))}>跳过</button><button className="btn primary" style={{ flex: 2 }} disabled={actScores[myLines[actI].i] === undefined} onClick={() => (actI + 1 < myLines.length ? setActI(actI + 1) : setStage('quiz'))}>{actI + 1 < myLines.length ? '下一句' : '去答题'}</button></div>
  ) : stage === 'quiz' ? (
    <button className="btn primary block" disabled={answers.some((a) => a === null)} onClick={() => setStage(words.length ? 'words' : 'done')}>{words.length ? '看看这集的生词' : '完成'}</button>
  ) : stage === 'words' ? (
    <button className="btn primary block" onClick={done}>完成这一集</button>
  ) : <button className="btn primary block" onClick={onClose}>好的</button>

  useEffect(() => { if (stage === 'done' && !words.length) done() }, [stage])

  return (
    <Overlay title={`${s.season > 1 ? `第 ${s.season} 季 ` : ''}第 ${ep.id} 集 · ${ep.title}`} sub={ep.title_zh} onClose={onClose} foot={foot}>
      {stage !== 'done' && <div className="stage-tabs">{STAGES.map(([k, t]) => <span key={k} className={k === stage ? 'on' : ''}>{t}</span>)}</div>}

      {stage === 'listen' && (
        <div className="chat fade-in">
          <p className="small muted scene">{ep.scene_zh}<br /><span className="faint">点一句看中文，点单词查意思</span></p>
          {ep.lines.slice(0, shown).map((_, i) => bubble(i))}
          <div ref={end} />
        </div>
      )}

      {stage === 'act' && (() => {
        const { l, i } = myLines[actI]
        const prev = i > 0 ? ep.lines[i - 1] : null
        return (
          <div className="fade-in" key={actI}>
            <p className="step-kind">你演林 · {actI + 1}/{myLines.length}</p>
            {prev && (
              <div className="act-prev">
                <span className="small muted">{s.cast[prev.who]?.zh ?? prev.who}：</span>
                <p className="en">{prev.en}</p>
                <PlayButton text={prev.en} clip={clip(i - 1)} accent={accent} label="听对方" />
              </div>
            )}
            <p className="shadow-sentence en" style={{ marginTop: 16 }}><Tappable text={l.en} karaoke /></p>
            <p className="shadow-zh">{l.zh}</p>
            <Shadow key={i} text={l.en} accent={accent} clip={clip(i)} onScored={async (r) => {
              setActScores((x) => ({ ...x, [i]: r.score }))
              const phones = r.words.flatMap((w) => w.phones.map((p) => [p.p, +p.s.toFixed(2)] as [string, number]))
              await saveAttempt(null, l.en, r.score, phones, [])
            }} />
          </div>
        )
      })()}

      {stage === 'quiz' && (
        <div className="fade-in">
          <p className="step-kind">听懂了吗？</p>
          {ep.quiz.map((q, k) => (
            <div key={k} style={{ marginTop: 18 }}>
              <b>{k + 1}. {q.q}</b>
              <div className="options" style={{ marginTop: 10 }}>
                {q.options.map((o, j) => {
                  const a = answers[k]
                  const st = a === null ? '' : j === q.answer ? 'right' : j === a ? 'wrong' : 'dim'
                  return <button key={j} className={`opt ${st}`} disabled={a !== null} onClick={() => setAnswers((x) => x.map((v, n) => (n === k ? j : v)))}><b style={{ fontWeight: 500 }}>{o}</b></button>
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {stage === 'words' && (
        <div className="fade-in">
          <p className="step-kind">这一集的生词 · 加进每日复习</p>
          <div className="list" style={{ marginTop: 12 }}>
            {words.map((w) => (
              <div className="list-row" key={w.w}>
                <span className="main"><b>{w.w}</b><span>/{w.ipa}/ · {w.zh.split(/[；;]/)[0]}</span></span>
                <PlayButton text={w.w} clip={{ text: w.w, word: w.w }} accent={accent} />
                <button className="btn small quiet" disabled={added.has(w.w)} onClick={async () => { await addCard(w.w); await markDay({ new_words: 1 }); setAdded((x) => new Set(x).add(w.w)) }}>{added.has(w.w) ? '已加' : '加入'}</button>
              </div>
            ))}
          </div>
          {words.length > 1 && added.size < words.length && <button className="btn ghost block" style={{ marginTop: 8 }} onClick={async () => { for (const w of words) if (!added.has(w.w)) { await addCard(w.w); await markDay({ new_words: 1 }) } setAdded(new Set(words.map((w) => w.w))); toast('都加进复习了') }}>全部加入</button>}
        </div>
      )}

      {stage === 'done' && (
        <div className="fade-in" style={{ textAlign: 'center', paddingTop: 32 }}>
          <div className="done-mark" aria-hidden><Icon.film /></div>
          <h2 style={{ margin: '10px 0 6px' }}>第 {ep.id} 集看完了</h2>
          <p className="muted">理解 {quizScore}/{ep.quiz.length}{actAvg !== null ? ` · 跟读平均 ${actAvg} 分` : ''}</p>
          <div className="card" style={{ marginTop: 22, textAlign: 'left' }}>
            <p className="small muted">下集预告</p>
            <p style={{ marginTop: 6 }}>{ep.next_zh}</p>
            <p className="small faint" style={{ marginTop: 8 }}>{ep.id < s.episodes.length ? `明天解锁第 ${ep.id + 1} 集` : '明天解锁下一季'}</p>
          </div>
        </div>
      )}
    </Overlay>
  )
}

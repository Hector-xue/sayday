// 30 秒专注（方案 1.7）：只练一组最难分的音。放一个词，点你听到的那个，点完马上放下一个，连对有连击。
// 嫌长时间练太累的时候用；成绩存每组的最好记录
import { useEffect, useRef, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { useApp } from '../store'
import { PAIR_SETS, setsFor, type PairSet } from '../lib/pairs'
import { play, prefetch, stopAudio } from '../lib/tts'
import { weakPhones } from '../lib/progress'
import { kvGet, kvSet } from '../lib/db'
import { markDay } from '../lib/lesson'

const SECONDS = 30
type Best = Record<string, number>

/** 默认练哪组：有弱项就挑和最弱的音有关的那组，没有就 /θ/ 和 /s/ */
export async function defaultSet(): Promise<PairSet> {
  for (const w of await weakPhones(5)) { const s = setsFor(w.phone)[0]; if (s) return s }
  return PAIR_SETS.find((s) => s.id === 'th-s')!
}

export function Focus({ onClose }: { onClose: () => void }) {
  const { profile } = useApp()
  const accent = profile!.accent
  const [set, setSet] = useState<PairSet | null>(null)
  const [phase, setPhase] = useState<'pick' | 'play' | 'done'>('pick')
  const [left, setLeft] = useState(SECONDS)
  const [round, setRound] = useState<{ pair: [string, string]; target: string } | null>(null)
  const [score, setScore] = useState({ ok: 0, n: 0, combo: 0, maxCombo: 0 })
  const [flash, setFlash] = useState<null | 'ok' | 'no'>(null)
  const [best, setBest] = useState<Best>({})
  const live = useRef(false)
  useEffect(() => { defaultSet().then(setSet); kvGet<Best>('focus_best', {}).then(setBest); return () => { live.current = false; stopAudio() } }, [])

  const next = (s: PairSet) => {
    const pair = s.pairs[Math.floor(Math.random() * s.pairs.length)]
    const r = { pair, target: pair[Math.random() < 0.5 ? 0 : 1] }
    setRound(r)
    play({ text: r.target, word: r.target }, accent).catch(() => {})
  }
  const start = () => {
    if (!set) return
    prefetch(set.pairs.flat().map((w) => ({ text: w, word: w })), accent)
    setScore({ ok: 0, n: 0, combo: 0, maxCombo: 0 }); setLeft(SECONDS); setPhase('play'); live.current = true
    next(set)
  }
  // 倒计时
  useEffect(() => {
    if (phase !== 'play') return
    const h = setInterval(() => setLeft((x) => x - 1), 1000)
    return () => clearInterval(h)
  }, [phase])
  useEffect(() => {
    if (phase !== 'play' || left > 0) return
    live.current = false; stopAudio(); setPhase('done')
    markDay({ seconds: SECONDS })
    if (set && score.ok > (best[set.id] ?? 0)) { const b = { ...best, [set.id]: score.ok }; setBest(b); kvSet('focus_best', b) }
  }, [left, phase])

  const tap = (w: string) => {
    if (!round || !set || flash) return
    const good = w === round.target
    setScore((s) => { const combo = good ? s.combo + 1 : 0; return { ok: s.ok + (good ? 1 : 0), n: s.n + 1, combo, maxCombo: Math.max(s.maxCombo, combo) } })
    setFlash(good ? 'ok' : 'no')
    // 答错多停一下，让你看清是哪个
    setTimeout(() => { setFlash(null); if (live.current) next(set) }, good ? 250 : 900)
  }

  if (!set) return null
  return (
    <Overlay title="30 秒专注" sub={set.title} onClose={onClose}>
      {phase === 'pick' && (
        <div className="fade-in focus">
          <p>放一个词，点你听到的那个。点完马上放下一个，30 秒看能对几个。</p>
          <div className="chips">{PAIR_SETS.map((s) => <button key={s.id} className="chip" aria-pressed={s.id === set.id} onClick={() => setSet(s)}>{s.title}</button>)}</div>
          <p className="small muted">{set.tip}</p>
          {best[set.id] ? <p className="small muted">这组最好成绩：30 秒对 {best[set.id]} 个</p> : null}
          <button className="btn primary block" onClick={start}>开始</button>
        </div>
      )}
      {phase === 'play' && round && (
        <div className="focus-play">
          <div className="focus-top"><b className="num">{left}</b><span className="small muted">秒</span><div className="spacer" /><span className="small">对 <b className="num">{score.ok}</b>{score.combo >= 3 ? ` · 连对 ${score.combo}` : ''}</span></div>
          <button className="btn quiet" onClick={() => play({ text: round.target, word: round.target }, accent).catch(() => {})}>再听一遍</button>
          <div className={`focus-opts ${flash ?? ''}`}>
            {round.pair.map((w) => (
              <button key={w} className={`opt ${flash && w === round.target ? 'right' : ''}`} onClick={() => tap(w)}><b className="en">{w}</b></button>
            ))}
          </div>
        </div>
      )}
      {phase === 'done' && (
        <div className="fade-in" style={{ textAlign: 'center', paddingTop: 32 }}>
          <div className="report-level" style={{ fontSize: 56 }}>{score.ok}</div>
          <p className="muted">30 秒对了 {score.ok} 个（共 {score.n} 个）{score.maxCombo >= 3 ? ` · 最多连对 ${score.maxCombo}` : ''}</p>
          {best[set.id] === score.ok && score.ok > 0 && <p className="small" style={{ marginTop: 6 }}>新纪录</p>}
          <p className="small muted" style={{ marginTop: 14 }}>{set.tip}</p>
          <div className="row" style={{ marginTop: 22, justifyContent: 'center' }}>
            <button className="btn quiet" onClick={() => setPhase('pick')}>换一组</button>
            <button className="btn primary" onClick={start}>再来 30 秒</button>
          </div>
        </div>
      )}
    </Overlay>
  )
}

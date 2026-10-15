// 发音实验室：弱项专项练习、最小对立（先听辨再说对）、音标口型
import { Icon } from '../components/icons'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { Overlay } from '../components/Overlay'
import { PlayButton } from '../components/PlayButton'
import { Shadow, HINT } from '../components/Shadow'
import { Recorder } from '../components/Recorder'
import { Mouth, MOUTH } from '../components/Mouth'
import { Tappable } from '../components/Tappable'
import { weakPhones } from '../lib/progress'
import { loadContent, pickSentence, type Sentence, type Word } from '../lib/content'
import { PAIR_SETS, judge, setsFor, type PairSet } from '../lib/pairs'
import { COMMON_HARD, IPA, ipa, VOWEL_SET } from '../lib/phones'
import { infer } from '../lib/speech/engine'
import { kvGet, kvSet } from '../lib/db'
import { markDay, saveAttempt } from '../lib/lesson'
import { prefetch, type Accent } from '../lib/tts'
import { vocabLevel } from '../lib/calibrate'
import { lastTests } from '../lib/ielts'
import { Speaking } from './Speaking'
import { Focus } from './Focus'

type PairStats = Record<string, { listen: [number, number]; speak: [number, number] }>
type View = null | { kind: 'speaking' } | { kind: 'focus' } | { kind: 'drill'; phone: string } | { kind: 'pairs'; set: PairSet; mode: 'listen' | 'speak' } | { kind: 'phone'; phone: string }

export function Lab({ onSetupAi }: { onSetupAi: () => void }) {
  const { profile, tick } = useApp()
  const [weak, setWeak] = useState<Awaited<ReturnType<typeof weakPhones>>>([])
  const [ps, setPs] = useState<PairStats>({})
  const [view, setView] = useState<View>(null)
  const [last, setLast] = useState<number | null>(null)
  useEffect(() => { weakPhones(4).then(setWeak); kvGet<PairStats>('pair_stats', {}).then(setPs); lastTests(1).then((r) => setLast(r[0]?.band ?? null)) }, [tick, view])
  if (!profile) return null
  const accent = profile.accent
  const pct = (x?: [number, number]) => (x && x[1] ? `${Math.round((x[0] / x[1]) * 100)}%` : '—')
  const weakSet = new Set(weak.map((w) => w.phone))

  return (
    <div className="page fade-in">
      <div className="page-head"><h1>发音</h1></div>

      <button className="card raised ai-card wide mock-card" onClick={() => setView({ kind: 'speaking' })}>
        <span className="small muted">约 12 分钟 · 三个部分</span>
        <b style={{ fontSize: 18 }}>雅思口语模考</b>
        <span>考官提问，你开口答；本机识别 + 流利度 + 发音，接了 AI 还能按四项标准打分{last !== null ? ` · 上次 ${last.toFixed(1)}` : ''}</span>
      </button>

      <button className="card ai-card wide focus-card" onClick={() => setView({ kind: 'focus' })}>
        <b>30 秒专注</b><span>只练一组最难分的音，像节奏小游戏：听一个点一个，看 30 秒能对几个</span>
      </button>

      <p className="section-title" style={{ marginTop: 0 }}>{weak.length ? '你的弱项' : '中国人常见的难点'}</p>
      <div className="list">
        {(weak.length ? weak.map((w) => ({ phone: w.phone, note: `练过 ${w.n} 次，${Math.round((w.bad / w.n) * 100)}% 没读准` })) : COMMON_HARD.slice(0, 4).map((p) => ({ phone: p, note: '跟读几句后，这里换成你自己的弱项' }))).map((x) => (
          <button className="list-row" key={x.phone} onClick={() => setView({ kind: 'drill', phone: x.phone })}>
            <span className="phone-badge">/{ipa(x.phone)}/</span>
            <span className="main"><b style={{ fontFamily: 'inherit', fontSize: 15 }}>{HINT[x.phone] ?? MOUTH[x.phone]?.label}</b><span>{x.note}</span></span>
            <span className="small" style={{ color: 'var(--brand)' }}>专项练</span>
          </button>
        ))}
      </div>

      <p className="section-title">最小对立 · 先听得出，再说得对</p>
      <div className="pair-grid">
        {PAIR_SETS.map((s) => (
          <div className={`card pair-card ${weakSet.has(s.a) || weakSet.has(s.b) ? 'hot' : ''}`} key={s.id}>
            <b>{s.title}</b>
            <p className="small muted en">{s.pairs.slice(0, 2).map((p) => p.join(' / ')).join(' · ')}</p>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn small quiet" onClick={() => setView({ kind: 'pairs', set: s, mode: 'listen' })}>听辨</button>
              <button className="btn small quiet" onClick={() => setView({ kind: 'pairs', set: s, mode: 'speak' })}>说对</button>
            </div>
            {(ps[s.id]?.listen[1] || ps[s.id]?.speak[1]) ? <p className="small faint" style={{ marginTop: 6 }}>听辨 {pct(ps[s.id]?.listen)} · 说对 {pct(ps[s.id]?.speak)}</p> : null}
          </div>
        ))}
      </div>

      <p className="section-title">音标口型</p>
      <div className="card">
        <p className="small muted" style={{ marginBottom: 10 }}>元音</p>
        <div className="phone-chips">{Object.keys(IPA).filter((p) => VOWEL_SET.has(p)).map((p) => <button key={p} onClick={() => setView({ kind: 'phone', phone: p })}>{IPA[p]}</button>)}</div>
        <p className="small muted" style={{ margin: '14px 0 10px' }}>辅音</p>
        <div className="phone-chips">{Object.keys(IPA).filter((p) => !VOWEL_SET.has(p)).map((p) => <button key={p} onClick={() => setView({ kind: 'phone', phone: p })}>{IPA[p]}</button>)}</div>
      </div>

      {view?.kind === 'speaking' && <Speaking onClose={() => setView(null)} onSetupAi={() => { setView(null); onSetupAi() }} />}
      {view?.kind === 'focus' && <Focus onClose={() => setView(null)} />}
      {view?.kind === 'drill' && <Drill phone={view.phone} accent={accent} onClose={() => setView(null)} onPairs={(s) => setView({ kind: 'pairs', set: s, mode: 'listen' })} />}
      {view?.kind === 'pairs' && <PairGame set={view.set} mode={view.mode} accent={accent} onClose={() => setView(null)} />}
      {view?.kind === 'phone' && <PhoneCard phone={view.phone} accent={accent} onClose={() => setView(null)} onDrill={() => setView({ kind: 'drill', phone: view.phone })} />}
    </div>
  )
}

/** 含这个音的常用词：从水平边界以内挑（认识的词才好专心练发音） */
async function drillItems(phone: string, frontier: number): Promise<{ words: Word[]; sents: Sentence[] }> {
  const { words, sentsByWord } = await loadContent()
  const cap = Math.max(1500, frontier)
  const pool = words.filter((w) => w.rank <= cap && w.cmu.includes(phone) && !w.sensitive && w.w.length >= 3 && w.w.length <= 8)
  const pick: Word[] = []
  const src = pool.slice(0, 400)
  while (pick.length < 4 && src.length) pick.push(src.splice(Math.floor(Math.random() * src.length), 1)[0])
  const used = new Set<number>()
  const sents = pick.map((w) => pickSentence(sentsByWord.get(w.w), w.rank, used)).filter((s): s is Sentence => { if (!s || used.has(s.id)) return false; used.add(s.id); return true }).slice(0, 2)
  return { words: pick, sents }
}

function Drill({ phone, accent, onClose, onPairs }: { phone: string; accent: Accent; onClose: () => void; onPairs: (s: PairSet) => void }) {
  const { profile, refresh } = useApp()
  const [items, setItems] = useState<{ text: string; word?: string; sentenceId?: number; zh: string }[] | null>(null)
  const [i, setI] = useState(0)
  const [scored, setScored] = useState(false)
  useEffect(() => {
    vocabLevel(profile!).then((lv) => drillItems(phone, lv.frontier)).then(({ words, sents }) => {
      const list: { text: string; word?: string; sentenceId?: number; zh: string }[] = [...words.map((w) => ({ text: w.w, word: w.w, zh: w.zh.split(/[；;]/)[0] })), ...sents.map((s) => ({ text: s.en, sentenceId: s.id, zh: s.zh }))]
      setItems(list)
      prefetch(list.map((x) => ({ text: x.text, word: x.word, sentenceId: x.sentenceId })), accent)
    })
  }, [phone])
  const it = items?.[i]
  const sets = setsFor(phone)
  return (
    <Overlay title={`专项练习 /${ipa(phone)}/`} onClose={() => { refresh(); onClose() }} foot={items && (it ? (
      <div className="row">
        <button className="btn quiet" style={{ flex: 1 }} onClick={() => { setScored(false); setI(i + 1) }}>跳过</button>
        <button className="btn primary" style={{ flex: 2 }} disabled={!scored} onClick={() => { setScored(false); setI(i + 1) }}>下一个</button>
      </div>
    ) : <button className="btn primary block" onClick={() => { refresh(); onClose() }}>完成</button>)}>
      {!items ? <div className="loading">挑练习内容…</div> : it ? (
        <div className="fade-in" key={i}>
          {i === 0 && (
            <div className="drill-intro">
              <Mouth phone={phone} size={150} />
              {HINT[phone] && <p className="small" style={{ marginTop: 8 }}>{HINT[phone]}</p>}
            </div>
          )}
          <p className="step-kind">{i + 1}/{items.length} · {it.word ? '单词' : '句子'}</p>
          <p className={it.word ? 'word-big' : 'shadow-sentence en'}>{it.word ? it.text : <Tappable text={it.text} karaoke />}</p>
          <p className="shadow-zh">{it.zh}</p>
          <Shadow key={it.text} text={it.text} sentenceId={it.sentenceId} accent={accent} onScored={async (r) => {
            const phones = r.words.flatMap((w) => w.phones.map((p) => [p.p, +p.s.toFixed(2)] as [string, number]))
            await saveAttempt(it.sentenceId ?? null, it.text, r.score, phones, [])
            if (!scored && !it.word) await markDay({ shadows: 1 })
            setScored(true)
          }} />
        </div>
      ) : (
        <div className="fade-in" style={{ textAlign: 'center', paddingTop: 40 }}>
          <div className="done-mark" aria-hidden><Icon.check /></div>
          <h2 style={{ margin: '10px 0 6px' }}>这一组练完了</h2>
          <p className="muted small">弱项排行会跟着你最近的跟读更新。</p>
          {sets.length > 0 && <div className="row" style={{ justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>{sets.map((s) => <button key={s.id} className="btn small quiet" onClick={() => onPairs(s)}>再练最小对立 {s.title}</button>)}</div>}
        </div>
      )}
    </Overlay>
  )
}

function PairGame({ set, mode, accent, onClose }: { set: PairSet; mode: 'listen' | 'speak'; accent: Accent; onClose: () => void }) {
  const ROUNDS = mode === 'listen' ? 10 : 8
  const rounds = useMemo(() => Array.from({ length: ROUNDS }, () => {
    const p = set.pairs[Math.floor(Math.random() * set.pairs.length)]
    const t = Math.random() < 0.5 ? 0 : 1
    return { pair: p, target: p[t], other: p[1 - t] }
  }), [set, mode])
  const [i, setI] = useState(0)
  const [ans, setAns] = useState<null | { ok: boolean; text: string }>(null)
  const [ok, setOk] = useState(0)
  const [ipaOf, setIpaOf] = useState<Map<string, string>>(new Map())
  const { toast } = useApp()
  useEffect(() => {
    loadContent().then((c) => setIpaOf(new Map(set.pairs.flat().map((w) => [w, c.byWord.get(w)?.ipa ?? '']))))
    prefetch(set.pairs.flat().map((w) => ({ text: w, word: w })), accent)
  }, [set])
  const r = rounds[i]
  const done = i >= ROUNDS
  const record = async (good: boolean, text: string) => {
    setAns({ ok: good, text })
    if (good) setOk((x) => x + 1)
    const st = await kvGet<PairStats>('pair_stats', {})
    const cur = st[set.id] ?? { listen: [0, 0], speak: [0, 0] }
    cur[mode] = [cur[mode][0] + (good ? 1 : 0), cur[mode][1] + 1]
    await kvSet('pair_stats', { ...st, [set.id]: cur })
  }
  const nextRound = () => { setAns(null); setI(i + 1) }
  const W = ({ w }: { w: string }) => <><b className="en">{w}</b>{ipaOf.get(w) && <span className="faint small"> /{ipaOf.get(w)}/</span>}</>

  return (
    <Overlay title={`${set.title} · ${mode === 'listen' ? '听辨' : '说对'}`} onClose={onClose} foot={!done && ans && <button className="btn primary block" onClick={nextRound}>{i + 1 < ROUNDS ? '下一题' : '看结果'}</button>}>
      {done ? (
        <div className="fade-in" style={{ textAlign: 'center', paddingTop: 40 }}>
          <div className="report-level" style={{ fontSize: 56 }}>{ok}/{ROUNDS}</div>
          <p className="muted" style={{ marginTop: 8 }}>{ok >= ROUNDS * 0.8 ? (mode === 'listen' ? '耳朵分得很清楚了，试试“说对”' : '这组音你已经分得开了') : '多来几轮，分得开的耳朵是说对的前提'}</p>
          <p className="small muted" style={{ marginTop: 14 }}>{set.tip}</p>
        </div>
      ) : mode === 'listen' ? (
        <div className="fade-in" key={i}>
          <p className="step-kind">{i + 1}/{ROUNDS} · 听到的是哪个？</p>
          <div className="listen-play" style={{ justifyContent: 'center', margin: '28px 0' }}>
            <PlayButton key={i} text={r.target} clip={{ text: r.target, word: r.target }} accent={accent} label="播放" />
          </div>
          <div className="options cols-2">
            {r.pair.map((w) => {
              const state = !ans ? '' : w === r.target ? 'right' : w === ans.text ? 'wrong' : 'dim'
              return <button key={w} className={`opt ${state}`} style={{ textAlign: 'center' }} disabled={!!ans} onClick={() => record(w === r.target, w)}><W w={w} /></button>
            })}
          </div>
          {ans && (
            <div className="row" style={{ marginTop: 16, justifyContent: 'center' }}>
              {r.pair.map((w) => <span className="row" key={w}><PlayButton text={w} clip={{ text: w, word: w }} accent={accent} /><span className="en">{w}</span></span>)}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 18 }}>{set.tip}</p>
        </div>
      ) : (
        <div className="fade-in" key={i}>
          <p className="step-kind">{i + 1}/{ROUNDS} · 读这个词</p>
          <div className="row"><div className="word-big">{r.target}</div><div className="spacer" /><PlayButton text={r.target} clip={{ text: r.target, word: r.target }} accent={accent} /></div>
          <p className="small muted">别读成 <span className="en">{r.other}</span>{ipaOf.get(r.other) ? ` /${ipaOf.get(r.other)}/` : ''}</p>
          <div className="pair-mouths">
            <Mouth phone={set.a} size={120} />
            <Mouth phone={set.b} size={120} />
          </div>
          {!ans && <Recorder hint="点一下，读上面的词" onAudio={async (a) => {
            const j = await judge(r.target, r.other, await infer(a))
            if (j.said === 'unclear') { toast('没听太清是哪个，读清楚一点再试一次'); return }
            await record(j.said === 'target', j.said === 'target' ? r.target : r.other)
          }} />}
          {ans && <p className={`judge ${ans.ok ? 'ok' : 'no'}`}>{ans.ok ? <>听起来是 <b className="en">{r.target}</b>，对了</> : <>听起来更像 <b className="en">{r.other}</b>，再对照口型图试试</>}</p>}
          <p className="small muted" style={{ marginTop: 14 }}>{set.tip}</p>
        </div>
      )}
    </Overlay>
  )
}
function PhoneCard({ phone, accent, onClose, onDrill }: { phone: string; accent: Accent; onClose: () => void; onDrill: () => void }) {
  const [ex, setEx] = useState<Word[]>([])
  useEffect(() => {
    loadContent().then((c) => {
      const ws = c.words.filter((w) => w.rank <= 2000 && w.cmu.includes(phone) && !w.sensitive && w.w.length >= 3).slice(0, 6)
      setEx(ws)
      prefetch(ws.map((w) => ({ text: w.w, word: w.w })), accent)
    })
  }, [phone])
  return (
    <Overlay title={`/${ipa(phone)}/`} onClose={onClose} foot={<button className="btn primary block" onClick={onDrill}>专项练习这个音</button>}>
      <div className="fade-in">
        <div className="drill-intro"><Mouth phone={phone} size={200} /></div>
        {HINT[phone] && <p style={{ marginTop: 12 }}>{HINT[phone]}</p>}
        <p className="section-title">例词</p>
        <div className="list">
          {ex.map((w) => (
            <div className="list-row" key={w.w}>
              <span className="main"><b>{w.w}</b><span>{w.ipa ? `/${w.ipa}/ · ` : ''}{w.zh.split(/[；;,，]/)[0]}</span></span>
              <PlayButton text={w.w} clip={{ text: w.w, word: w.w }} accent={accent} />
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  )
}

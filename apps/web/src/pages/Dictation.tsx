// 听写：从学过的词里挑 10 个，听音 + 看意思写出来。写对的往后排、写错的明天再来（记进复习），最后列出写错的
import { useEffect, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { SpellCard } from '../components/SpellCard'
import { useApp } from '../store'
import { db } from '../lib/db'
import { loadContent, type Word } from '../lib/content'
import { canSpell, type SpellResult } from '../lib/spell'
import { grade, Rating } from '../lib/srs'
import { markDay } from '../lib/lesson'

const N = 10

/** 挑词：学过的（复习过至少一次）、能拼的；最近写错过的、快到期的优先，再随机补满 */
export async function pickDictation(n = N): Promise<Word[]> {
  const { byWord } = await loadContent()
  const rows = await db.all<{ word: string; due: number; lapses: number }>('SELECT word, due, lapses FROM card WHERE known = 0 AND reps >= 1')
  const ok = rows.filter((r) => canSpell(r.word) && byWord.has(r.word))
  const head = [...ok].sort((a, b) => b.lapses - a.lapses || a.due - b.due).slice(0, Math.ceil(n / 2))
  const rest = ok.filter((r) => !head.includes(r)).sort(() => Math.random() - 0.5).slice(0, n - head.length)
  return [...head, ...rest].sort(() => Math.random() - 0.5).map((r) => byWord.get(r.word)!)
}

export function Dictation({ onClose }: { onClose: () => void }) {
  const { profile, refresh } = useApp()
  const [words, setWords] = useState<Word[] | null>(null)
  const [i, setI] = useState(0)
  const [res, setRes] = useState<Record<number, SpellResult>>({})
  const [t0] = useState(performance.now())
  useEffect(() => { pickDictation().then(setWords) }, [])
  useEffect(() => () => { markDay({ seconds: (performance.now() - t0) / 1000 }) }, [])
  if (!words || !profile) return <Overlay title="听写" onClose={onClose}><div className="loading">…</div></Overlay>
  if (words.length < 3) return (
    <Overlay title="听写" onClose={onClose}>
      <p className="muted" style={{ textAlign: 'center', marginTop: 40 }}>学过的词还太少。每天练习里学几个新词、复习一两次，就能来听写了。</p>
    </Overlay>
  )
  const done = i >= words.length
  const right = Object.values(res).filter((r) => r === 'right').length
  const wrong = words.filter((_, k) => res[k] && res[k] !== 'right')
  return (
    <Overlay title="听写" sub={done ? `写对 ${right}/${words.length}` : `${i + 1}/${words.length}`} onClose={() => { refresh(); onClose() }}
      foot={done ? <button className="btn primary block" onClick={() => { refresh(); onClose() }}>好的</button> : res[i] ? <button className="btn primary block" onClick={() => setI(i + 1)}>{i + 1 < words.length ? '下一个' : '看结果'}</button> : undefined}>
      {done ? (
        <div className="fade-in" style={{ textAlign: 'center', paddingTop: 24 }}>
          <div className="report-level" style={{ fontSize: 56 }}>{right}/{words.length}</div>
          <p className="muted">{right === words.length ? '全对！' : '写错的已经记进复习，明天还会再见到'}</p>
          {wrong.length > 0 && <div className="list" style={{ marginTop: 18, textAlign: 'left' }}>{wrong.map((w) => <div className="list-row" key={w.w}><span className="main"><b>{w.w}</b><span>{w.ipa ? `/${w.ipa}/ · ` : ''}{w.zh.split(/[；;]/)[0]}</span></span></div>)}</div>}
        </div>
      ) : (
        <SpellCard key={i} word={words[i]} accent={profile.accent} onResult={async (r) => {
          setRes((x) => ({ ...x, [i]: r }))
          await grade(words[i].w, (r === 'right' ? Rating.Good : r === 'close' ? Rating.Hard : Rating.Again) as any)
        }} />
      )}
    </Overlay>
  )
}

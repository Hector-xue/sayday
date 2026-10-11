import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { db } from '../lib/db'
import { loadContent, pickSentence, type Word } from '../lib/content'
import { PlayButton } from '../components/PlayButton'
import { State, addCard } from '../lib/srs'

type Row = { word: string; due: number; state: number; reps: number; lapses: number; known: number; stability: number }
type Filter = 'learning' | 'mastered' | 'known'

function nextLabel(due: number) {
  const d = (due - Date.now()) / 86400_000
  if (d <= 0) return '该复习了'
  if (d < 1) return '今天内'
  return `${Math.round(d)} 天后`
}

export function Words() {
  const { tick, profile, refresh, toast } = useApp()
  const [allWords, setAllWords] = useState<Word[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [byWord, setByWord] = useState<Map<string, Word>>(new Map())
  const [q, setQ] = useState('')
  const [f, setF] = useState<Filter>('learning')
  const [open, setOpen] = useState<Word | null>(null)
  const [sents, setSents] = useState<Awaited<ReturnType<typeof loadContent>>['sentsByWord'] | null>(null)
  useEffect(() => {
    db.all<Row>('SELECT word, due, state, reps, lapses, known, stability FROM card ORDER BY added DESC').then(setRows)
    loadContent().then((c) => { setByWord(c.byWord); setSents(c.sentsByWord); setAllWords(c.words) })
  }, [tick])
  const groups = useMemo(() => ({
    learning: rows.filter((r) => !r.known && (r.state !== State.Review || r.stability < 21)),
    mastered: rows.filter((r) => !r.known && r.state === State.Review && r.stability >= 21),
    known: rows.filter((r) => r.known),
  }), [rows])
  const list = groups[f].filter((r) => !q || r.word.includes(q.toLowerCase().trim()) || byWord.get(r.word)?.zh.includes(q.trim()))
  // 搜索时顺带查整本词典：还没学的词可以直接加入
  const have = useMemo(() => new Set(rows.map((r) => r.word)), [rows])
  const dict = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    const en = /^[a-z'-]+$/.test(t)
    return allWords.filter((w) => !have.has(w.w) && (en ? w.w.startsWith(t) : w.zh.includes(q.trim()))).slice(0, 20)
  }, [q, allWords, have])
  const addWord = async (w: Word) => { await addCard(w.w); toast(`已加入：${w.w}`); refresh() }

  return (
    <div className="page fade-in">
      <div className="page-head"><h1>词库</h1><span className="small muted">共 {rows.length - groups.known.length} 个在学</span></div>
      <input className="search" placeholder="搜英文或中文" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="seg" style={{ margin: '12px 0' }} role="group">
        {([['learning', `学习中 ${groups.learning.length}`], ['mastered', `已掌握 ${groups.mastered.length}`], ['known', `早就认识 ${groups.known.length}`]] as [Filter, string][]).map(([k, t]) => (
          <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>{t}</button>
        ))}
      </div>
      {list.length === 0 && !(q && dict.length) ? (
        <div className="card"><p className="muted small">{rows.length ? '这里还没有词。' : '还没开始学。去“今天”开始第一组练习，学过的词会出现在这里。'}</p></div>
      ) : list.length === 0 ? null : (
        <div className="list">
          {list.slice(0, 300).map((r) => {
            const w = byWord.get(r.word)
            return (
              <button className="list-row" key={r.word} onClick={() => w && setOpen(w)}>
                <div className="main"><b>{r.word}</b><span>{w?.zh ?? ''}</span></div>
                <div className="side">{r.known ? '' : nextLabel(r.due)}{r.lapses ? <><br />忘过 {r.lapses} 次</> : null}</div>
              </button>
            )
          })}
        </div>
      )}
      {list.length > 300 && <p className="small faint" style={{ marginTop: 8 }}>只显示前 300 个，用搜索找其他的。</p>}
      {dict.length > 0 && (
        <>
          <p className="section-title">词典里的</p>
          <div className="list">
            {dict.map((w) => (
              <div className="list-row" key={w.w}>
                <button className="main" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => setOpen(w)}><b>{w.w}</b><span>{w.zh}</span></button>
                <button className="btn small quiet" onClick={() => addWord(w)}>加入学习</button>
              </div>
            ))}
          </div>
        </>
      )}
      {open && profile && (
        <div className="sheet-mask" onClick={() => setOpen(null)}>
          <div className="sheet fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="row"><div className="word-big" style={{ fontSize: 36 }}>{open.w}</div><div className="spacer" /><PlayButton text={open.w} clip={{ text: open.w, word: open.w }} accent={profile.accent} /></div>
            <p className="ipa">/{open.ipa}/ · 第 {open.rank.toLocaleString()} 常用 · {open.cefr}</p>
            <p className="zh-mean">{open.zh}</p>
            {(() => { const s = pickSentence(sents?.get(open.w), open.rank); return s ? (
              <div className="example"><p className="en">{s.en}</p><p className="zh">{s.zh}</p><div className="row" style={{ marginTop: 10 }}><PlayButton text={s.en} clip={{ text: s.en, sentenceId: s.id }} accent={profile.accent} label="听例句" /></div></div>
            ) : null })()}
            <button className="btn quiet block" style={{ marginTop: 18 }} onClick={() => setOpen(null)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  )
}

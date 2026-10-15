import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { db } from '../lib/db'
import { loadContent, pickSentence, rankLabel, type Word } from '../lib/content'
import { PlayButton } from '../components/PlayButton'
import { State, addCard } from '../lib/srs'
import { BOOKS, bookName, inBook } from '../lib/books'
import { Sheet } from '../components/Sheet'
import { FUNCTION_WORDS } from '../lib/lesson'
import { Dictation } from './Dictation'

type Row = { word: string; due: number; state: number; reps: number; lapses: number; known: number; stability: number }
type Filter = 'learning' | 'mastered' | 'known'

function nextLabel(due: number) {
  const d = (due - Date.now()) / 86400_000
  if (d <= 0) return '该复习了'
  if (d < 1) return '今天内'
  return `${Math.round(d)} 天后`
}

export function Words() {
  const { tick, profile, setProfile, refresh, toast } = useApp()
  const [pickBook, setPickBook] = useState(false)
  const [dict10, setDict10] = useState(false)
  const [browse, setBrowse] = useState(false)
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

  // 词书：书里的词、各自学到哪了
  const book = profile?.book
  const status = useMemo(() => new Map(rows.map((r) => [r.word, r.known ? 'known' : r.state === State.Review && r.stability >= 21 ? 'mastered' : 'learning'] as const)), [rows])
  // 虚词（in、on、the……）不单独当新词学，词书里也不列
  const bookable = useMemo(() => allWords.filter((w) => !FUNCTION_WORDS.has(w.w) && !w.sensitive), [allWords])
  const bookCounts = useMemo(() => new Map(BOOKS.map((b) => [b.tag, bookable.filter((w) => inBook(w, b.tag)).length])), [bookable])
  const bookWords = useMemo(() => (book ? bookable.filter((w) => inBook(w, book)) : []), [bookable, book])
  const bookLearned = bookWords.filter((w) => status.has(w.w)).length
  const bookMastered = bookWords.filter((w) => { const s = status.get(w.w); return s === 'mastered' || s === 'known' }).length
  const chooseBook = async (tag: string) => {
    if (!profile) return
    const { book: _, ...rest } = profile
    await setProfile(tag ? { ...rest, book: tag } : rest)
    setPickBook(false)
    toast(tag ? `之后的新词按「${bookName(tag)}」来` : '之后的新词按常用程度来')
  }

  return (
    <div className="page fade-in">
      <div className="page-head"><h1>词库</h1><span className="small muted">共 {rows.length - groups.known.length} 个在学</span></div>
      <button className="card ai-card wide dictation-card" onClick={() => setDict10(true)}>
        <b>听写</b><span>听音、看意思，写出 10 个学过的词。光认得不够，还要写得出来</span>
      </button>
      {dict10 && <Dictation onClose={() => setDict10(false)} />}

      <div className="card book-card">
        <div className="row">
          <div className="book-name"><span className="small muted">词书</span><b>{bookName(book)}</b></div>
          <div className="spacer" />
          {book && <button className="btn small quiet" onClick={() => setBrowse(true)}>浏览</button>}
          <button className="btn small quiet" onClick={() => setPickBook(true)}>{book ? '换一本' : '选词书'}</button>
        </div>
        {book ? (
          <>
            <div className="bar" style={{ marginTop: 14 }}><i style={{ width: `${bookWords.length ? (bookLearned / bookWords.length) * 100 : 0}%` }} /></div>
            <p className="small muted" style={{ marginTop: 8 }}>已学 {bookLearned.toLocaleString()} / {bookWords.length.toLocaleString()} · 掌握 {bookMastered.toLocaleString()}</p>
          </>
        ) : (
          <p className="small muted" style={{ marginTop: 8 }}>新词按常用程度、从你的水平往上排{profile?.goal.kind === 'ielts' ? '，雅思词优先' : ''}。要按考试大纲背，选一本词书。</p>
        )}
      </div>
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
      {pickBook && (
        <Sheet onClose={() => setPickBook(false)}>
            <h2 style={{ fontSize: 20 }}>选词书</h2>
            <p className="small muted" style={{ marginTop: 4 }}>换了之后，每天的新词从这本书里出；已经学的词不受影响。</p>
            <div className="list" style={{ marginTop: 14 }}>
              <button className="list-row" aria-pressed={!book} onClick={() => chooseBook('')}>
                <span className="main"><b>按常用程度</b><span>从你的水平往上，最常用的先学</span></span>
                <span className="side">{!book ? '在用' : ''}</span>
              </button>
              {BOOKS.map((b) => (
                <button key={b.tag} className="list-row" aria-pressed={book === b.tag} onClick={() => chooseBook(b.tag)}>
                  <span className="main"><b>{b.name}</b><span>{b.desc} · {(bookCounts.get(b.tag) ?? 0).toLocaleString()} 词</span></span>
                  <span className="side">{book === b.tag ? '在用' : ''}</span>
                </button>
              ))}
            </div>
            <p className="small faint" style={{ marginTop: 10 }}>词书按考试大纲收词（常用 1.2 万词之外的大纲词也在），考试标签来自 ECDICT。</p>
        </Sheet>
      )}
      {browse && book && <BookBrowser words={bookWords} status={status} title={bookName(book)} onOpen={(w) => setOpen(w)} onAdd={addWord} onClose={() => setBrowse(false)} />}
      {open && profile && (
        <Sheet onClose={() => setOpen(null)}>
            <div className="row"><div className="word-big" style={{ fontSize: 36 }}>{open.w}</div><div className="spacer" /><PlayButton text={open.w} clip={{ text: open.w, word: open.w }} accent={profile.accent} /></div>
            <p className="ipa">{open.ipa ? `/${open.ipa}/ · ` : ''}{rankLabel(open)} · {open.cefr}</p>
            <p className="zh-mean">{open.zh}</p>
            {(() => { const s = pickSentence(sents?.get(open.w), open.rank); return s ? (
              <div className="example"><p className="en">{s.en}</p><p className="zh">{s.zh}</p><div className="row" style={{ marginTop: 10 }}><PlayButton text={s.en} clip={{ text: s.en, sentenceId: s.id }} accent={profile.accent} label="听例句" /></div></div>
            ) : null })()}
            <button className="btn quiet block" style={{ marginTop: 18 }} onClick={() => setOpen(null)}>关闭</button>
        </Sheet>
      )}
    </div>
  )
}

const LABEL = { learning: '学习中', mastered: '已掌握', known: '认识' } as const
type St = keyof typeof LABEL

/** 浏览词书：按常用程度排，分“没学 / 在学 / 掌握了”看，没学的可以直接加入 */
function BookBrowser({ words, status, title, onOpen, onAdd, onClose }: { words: Word[]; status: Map<string, St>; title: string; onOpen: (w: Word) => void; onAdd: (w: Word) => void; onClose: () => void }) {
  const [f, setF] = useState<'new' | 'learning' | 'done'>('new')
  const [n, setN] = useState(100)
  const groups = useMemo(() => ({
    new: words.filter((w) => !status.has(w.w)),
    learning: words.filter((w) => status.get(w.w) === 'learning'),
    done: words.filter((w) => { const s = status.get(w.w); return s === 'mastered' || s === 'known' }),
  }), [words, status])
  const list = groups[f]
  return (
    <Sheet onClose={onClose} className="book-browser">
        <h2 style={{ fontSize: 20 }}>{title} · {words.length.toLocaleString()} 词</h2>
        <div className="seg" style={{ margin: '12px 0' }}>
          {([['new', `没学 ${groups.new.length}`], ['learning', `在学 ${groups.learning.length}`], ['done', `掌握 ${groups.done.length}`]] as const).map(([k, t]) => (
            <button key={k} aria-pressed={f === k} onClick={() => { setF(k); setN(100) }}>{t}</button>
          ))}
        </div>
        {list.length === 0 ? <p className="small muted">这里还没有词。</p> : (
          <div className="list">
            {list.slice(0, n).map((w) => (
              <div className="list-row" key={w.w}>
                <button className="main" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => onOpen(w)}><b>{w.w}</b><span>{w.zh}</span></button>
                {status.has(w.w) ? <span className="side">{LABEL[status.get(w.w)!]}</span> : <button className="btn small quiet" onClick={() => onAdd(w)}>加入学习</button>}
              </div>
            ))}
          </div>
        )}
        {list.length > n && <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => setN(n + 200)}>再显示 200 个</button>}
        <button className="btn quiet block" style={{ marginTop: 12 }} onClick={onClose}>关闭</button>
    </Sheet>
  )
}

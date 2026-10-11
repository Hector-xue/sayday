// 双语日记：写几句今天的事 → AI 改错（逐条说明）→ 更地道的版本可以听、可以逐句跟读打分
import { useEffect, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { Shadow } from '../components/Shadow'
import { PlayButton } from '../components/PlayButton'
import { Tappable } from '../components/Tappable'
import { useApp } from '../store'
import { AiError, getAi, type AiConfig } from '../lib/ai'
import { correct, deleteEntry, entries, saveEntry, type DiaryResult, type Entry } from '../lib/diary'
import { vocabLevel } from '../lib/calibrate'
import { today } from '../lib/db'
import { saveAttempt } from '../lib/lesson'

const sentences = (t: string) => (t.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || []).map((s) => s.trim()).filter((s) => /[A-Za-z]/.test(s))

export function Diary({ onClose, onSetup }: { onClose: () => void; onSetup: () => void }) {
  const { profile } = useApp()
  const [cfg, setCfg] = useState<AiConfig | null | undefined>(undefined)
  const [list, setList] = useState<Entry[]>([])
  const [open, setOpen] = useState<null | { id?: number; text: string; result: DiaryResult | null }>(null)
  useEffect(() => {
    getAi().then(setCfg)
    entries().then((es) => {
      setList(es)
      // 今天写过就直接打开今天那篇
      const t = es.find((e) => e.date === today())
      setOpen(t ? { id: t.id, text: t.text, result: t.result } : { text: '', result: null })
    })
  }, [])

  if (cfg === null) return (
    <Overlay title="日记" onClose={onClose}>
      <div style={{ textAlign: 'center', paddingTop: 40 }}>
        <p className="muted">日记批改要先接入你自己的 AI。</p>
        <button className="btn primary" style={{ marginTop: 16 }} onClick={onSetup}>去接入</button>
      </div>
    </Overlay>
  )
  if (!open || cfg === undefined) return <Overlay title="日记" onClose={onClose}><div className="loading">…</div></Overlay>
  return <Editor key={open.id ?? 'new'} cfg={cfg} accent={profile!.accent} init={open} list={list} onPick={(e) => setOpen(e ? { id: e.id, text: e.text, result: e.result } : { text: '', result: null })}
    onSaved={() => entries().then(setList)} onClose={onClose} levelOf={() => vocabLevel(profile!).then((l) => l.cefr)} />
}

function Editor({ cfg, accent, init, list, onPick, onSaved, onClose, levelOf }: {
  cfg: AiConfig; accent: 'us' | 'gb'; init: { id?: number; text: string; result: DiaryResult | null }; list: Entry[]
  onPick: (e: Entry | null) => void; onSaved: () => void; onClose: () => void; levelOf: () => Promise<any>
}) {
  const [text, setText] = useState(init.text)
  const [res, setRes] = useState<DiaryResult | null>(init.result)
  const [id, setId] = useState(init.id)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [practice, setPractice] = useState<string | null>(null)
  const [showList, setShowList] = useState(false)

  const go = async () => {
    setBusy(true); setErr('')
    try {
      const r = await correct(cfg, await levelOf(), text.trim())
      setRes(r)
      setId(await saveEntry(text.trim(), r, id))
      onSaved()
    } catch (e) {
      setErr(e instanceof AiError ? e.message : '出错了：' + ((e as Error).message || e))
      // 没改成也先把写的存下来
      setId(await saveEntry(text.trim(), null, id))
    } finally { setBusy(false) }
  }
  const words = (text.match(/[A-Za-z]+/g) || []).length

  return (
    <Overlay title="日记" sub={init.id ? list.find((e) => e.id === init.id)?.date : '今天'} onClose={async () => { if (text.trim() && !res) await saveEntry(text.trim(), null, id); onClose() }}
      right={<button className="btn small ghost" onClick={() => setShowList(true)}>以前的</button>}
      foot={!res ? <button className="btn primary block" disabled={busy || words < 3} onClick={go}>{busy ? 'AI 在看…' : '帮我改'}</button>
        : <button className="btn quiet block" onClick={() => setRes(null)}>改一改再提交</button>}>
      {!res ? (
        <>
          <p className="small muted" style={{ marginBottom: 10 }}>写几句今天的事。不会的词直接写中文，AI 会教你怎么说。</p>
          <textarea className="diary-edit" value={text} onChange={(e) => setText(e.target.value)} placeholder="Today I…" autoFocus rows={9} />
          <p className="small faint" style={{ marginTop: 6 }}>{words} 个英文词{words < 3 ? ' · 至少写 3 个词' : ''}</p>
          {err && <div className="err-box">{err}</div>}
        </>
      ) : (
        <div className="fade-in diary-res">
          <div className="card raised"><p>{res.comment}</p></div>
          {res.edits.length > 0 && (
            <>
              <p className="section-title">改了这些</p>
              <div className="list">
                {res.edits.map((e, i) => (
                  <div className="edit" key={i}>
                    <p><s className="from">{e.from}</s> → <b className="to en">{e.to}</b></p>
                    {e.why && <p className="small muted">{e.why}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
          <p className="section-title">更地道的写法 · 点一句跟读</p>
          <div className="card natural">
            {sentences(res.natural).map((s, i) => (
              <p key={i} className={`en nat ${practice === s ? 'on' : ''}`} onClick={() => setPractice(practice === s ? null : s)}>{s}</p>
            ))}
            <div className="row" style={{ marginTop: 10 }}><PlayButton text={res.natural} accent={accent} label="听全文" /><span className="small muted">听全文</span></div>
          </div>
          {practice && (
            <div className="card" style={{ marginTop: 12 }}>
              <p className="shadow-sentence en" style={{ fontSize: 20 }}><Tappable text={practice} /></p>
              <Shadow key={practice} text={practice} accent={accent} onScored={async (r) => {
                const phones = r.words.flatMap((w) => w.phones.map((p) => [p.p, +p.s.toFixed(2)] as [string, number]))
                await saveAttempt(null, practice, r.score, phones, [])
              }} />
            </div>
          )}
          {res.phrases.length > 0 && (
            <>
              <p className="section-title">值得记的表达</p>
              <div className="list">
                {res.phrases.map((p, i) => (
                  <div className="list-row" key={i}><span className="main"><b>{p.en}</b><span>{p.zh}</span></span><PlayButton text={p.en} accent={accent} /></div>
                ))}
              </div>
            </>
          )}
          <p className="section-title">你写的（改正后）</p>
          <div className="card"><p className="en">{res.corrected}</p></div>
        </div>
      )}
      {showList && (
        <Overlay title="以前的日记" onClose={() => setShowList(false)} foot={<button className="btn primary block" onClick={() => { setShowList(false); onPick(null) }}>写一篇新的</button>}>
          {list.length === 0 ? <p className="muted small">还没有。</p> : (
            <div className="list">
              {list.map((e) => (
                <div className="list-row" key={e.id}>
                  <button className="main" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0 }} onClick={() => { setShowList(false); onPick(e) }}>
                    <b style={{ fontFamily: 'inherit', fontSize: 15 }}>{e.date}</b><span>{e.text.slice(0, 60)}</span>
                  </button>
                  <button className="btn small ghost" style={{ color: 'var(--bad)' }} onClick={async () => { if (confirm('删掉这篇？')) { await deleteEntry(e.id); onSaved(); setShowList(false); onPick(null) } }}>删</button>
                </div>
              ))}
            </div>
          )}
        </Overlay>
      )}
    </Overlay>
  )
}

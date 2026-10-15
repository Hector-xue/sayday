// 和 Emma 聊天：打字聊（中英混着写也行），她按你的水平回话、顺手纠正明显的错，回话可以朗读、看翻译、点词查义
import { useEffect, useRef, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { Icon } from '../components/icons'
import { Tappable } from '../components/Tappable'
import { MicInput } from '../components/MicInput'
import { useApp } from '../store'
import { AiError, getAi, type AiConfig } from '../lib/ai'
import { clearChat, getMemory, getPersona, history, markNudgeRead, PERSONAS, send, setPersona, type ChatMsg, type Persona } from '../lib/companion'
import { speak, stopSpeak } from '../lib/speak'
import { vocabLevel } from '../lib/calibrate'
import { db } from '../lib/db'
import { markDay } from '../lib/lesson'
import type { Cefr } from '../lib/levels'

function Say({ text }: { text: string }) {
  const { profile } = useApp()
  const [on, setOn] = useState(false)
  const [err, setErr] = useState(false)
  return (
    <button className={`mini-btn ${on ? 'on' : ''}`} aria-label="朗读" onClick={async () => {
      if (on) { stopSpeak(); setOn(false); return }
      setOn(true); setErr(false)
      try { await speak(text, profile!.accent) } catch { setErr(true) } finally { setOn(false) }
    }}>{on ? <Icon.stop /> : <Icon.play />}{err ? <span className="small">无法朗读</span> : null}</button>
  )
}

export function Chat({ onClose, onSetup }: { onClose: () => void; onSetup: () => void }) {
  const { profile } = useApp()
  const [cfg, setCfg] = useState<AiConfig | null | undefined>(undefined)
  const [level, setLevel] = useState<Cefr>('B1')
  const [words, setWords] = useState<string[]>([])
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [draft, setDraft] = useState('')
  const [live, setLive] = useState<string | null>(null)
  const [err, setErr] = useState<{ msg: string; retry: () => void } | null>(null)
  const [zh, setZh] = useState<Set<number>>(new Set())
  const [mem, setMem] = useState<string[] | null>(null)
  const [per, setPer] = useState<Persona>('warm')
  const end = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)
  const opened = useRef(performance.now())

  useEffect(() => {
    getAi().then(setCfg)
    vocabLevel(profile!).then((l) => setLevel(l.cefr))
    // 最近学的词，Emma 会顺手用上（复现）
    db.all<{ word: string }>('SELECT word FROM card WHERE known = 0 ORDER BY added DESC LIMIT 12').then((r) => setWords(r.map((x) => x.word)))
    history().then(setMsgs)
    markNudgeRead().catch(() => {})
    getPersona().then(setPer)
    return () => { abort.current?.abort(); stopSpeak(); markDay({ seconds: (performance.now() - opened.current) / 1000 }) }
  }, [])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs, live])

  const run = async (text: string | null) => {
    if (!cfg) return
    setErr(null)
    setLive('')
    abort.current = new AbortController()
    if (text) setMsgs((m) => [...m, { id: -Date.now(), role: 'user', content: text, ts: Date.now() }])
    try {
      await send(cfg, level, words, text, (t) => setLive(t), abort.current.signal)
      setMsgs(await history())
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      const msg = e instanceof AiError ? e.message : '出错了：' + ((e as Error).message || e)
      setMsgs(await history())
      setErr({ msg, retry: () => run(null) })
    } finally {
      setLive(null)
    }
  }
  // 打开时：没聊过或隔了半天以上，Emma 先开口
  const greeted = useRef(false)
  useEffect(() => {
    if (!cfg || greeted.current) return
    greeted.current = true
    history(1).then((h) => { if (!h.length || Date.now() - h[0].ts > 6 * 3600_000) run(null) })
  }, [cfg])

  const submit = () => {
    const t = draft.trim()
    if (!t || live !== null) return
    setDraft('')
    run(t)
  }
  // 纠正挂在 Emma 那条上，显示在它前面那条“你”的消息下面
  const fixFor = (i: number) => (msgs[i].role === 'user' && msgs[i + 1]?.role === 'assistant' ? msgs[i + 1].fix : null)

  if (cfg === null) return (
    <Overlay title="和 Emma 聊天" onClose={onClose}>
      <div style={{ textAlign: 'center', paddingTop: 40 }}>
        <p className="muted">要先接入你自己的 AI（DeepSeek、通义、Kimi 等都行）。</p>
        <button className="btn primary" style={{ marginTop: 16 }} onClick={onSetup}>去接入</button>
      </div>
    </Overlay>
  )

  return (
    <Overlay title="Emma" sub={`住在伦敦的室友 · ${PERSONAS.find((x) => x.k === per)!.t}`} onClose={onClose}
      right={<button className="btn small ghost" onClick={async () => setMem(await getMemory())}>性格和记忆</button>}
      foot={
        <div className="composer">
          <MicInput disabled={live !== null} onText={(t) => setDraft((d) => (d ? d + ' ' : '') + t)} />
          <textarea rows={1} value={draft} placeholder="打字或点麦克风说，不会的直接写中文" onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} />
          <button className="btn primary" disabled={!draft.trim() || live !== null} onClick={submit}>发送</button>
        </div>
      }>
      <div className="chat">
        {msgs.length === 0 && live === null && <p className="small muted" style={{ textAlign: 'center', marginTop: 24 }}>Emma 马上来…</p>}
        {msgs.map((m, i) => (
          <div key={m.id} className={`bubble-row ${m.role}`}>
            <div className={`bubble ${m.role}`}>
              {m.role === 'assistant' ? <span className="en"><Tappable text={m.content} /></span> : m.content}
              {m.role === 'assistant' && (
                <div className="bubble-tools">
                  <Say text={m.content} />
                  {m.zh && <button className="mini-btn" onClick={() => setZh((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })}>译</button>}
                </div>
              )}
              {zh.has(m.id) && m.zh && <p className="bubble-zh">{m.zh}</p>}
            </div>
            {fixFor(i) && (
              <div className="fix">
                <span className="small muted">更地道：</span><b className="en">{fixFor(i)!.better}</b>
                {fixFor(i)!.why && <span className="small muted"> · {fixFor(i)!.why}</span>}
              </div>
            )}
          </div>
        ))}
        {live !== null && <div className="bubble-row assistant"><div className="bubble assistant en">{live || <span className="typing"><i /><i /><i /></span>}</div></div>}
        {err && <div className="err-box">{err.msg} <button className="btn small quiet" style={{ marginLeft: 8 }} onClick={err.retry}>重试</button></div>}
        <div ref={end} />
      </div>
      {mem && (
        <Overlay title="Emma" sub="性格和她记得的事" onClose={() => setMem(null)} foot={<button className="btn quiet block" onClick={async () => { if (confirm('清空聊天记录？她记得的事会保留。')) { await clearChat(); setMsgs([]); setMem(null) } }}>清空聊天记录</button>}>
          <p className="section-title" style={{ marginTop: 0 }}>性格</p>
          <div className="list persona-list">
            {PERSONAS.map((x) => (
              <button key={x.k} className={`set-row ${per === x.k ? 'on' : ''}`} aria-pressed={per === x.k} onClick={async () => { await setPersona(x.k); setPer(x.k) }}>
                <div className="k"><b>{x.t}</b><span>{x.s}</span></div>{per === x.k && <Icon.check />}
              </button>
            ))}
          </div>
          <p className="section-title">她记得的事</p>
          {mem.length ? <ul className="tips" style={{ background: 'none', padding: 0 }}>{mem.map((f) => <li key={f} className="en">{f}</li>)}</ul> : <p className="muted small">还没记住什么。多聊几句，她会记下你的名字、工作、爱好这些。</p>}
          <p className="small faint" style={{ marginTop: 16 }}>每聊 6 句，AI 会把值得记住的事整理一次，只存在这台设备上。</p>
        </Overlay>
      )}
    </Overlay>
  )
}

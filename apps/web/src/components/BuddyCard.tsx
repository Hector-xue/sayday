// 进步页“学习搭子”：拉几个朋友一起，只看本周各自练了几天，不排行
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { getBuddy, joinGroup, leaveGroup, members, pushCard, type Buddy, type Member } from '../lib/buddy'
import { validCode } from '../lib/sync'

export function BuddyCard() {
  const { toast } = useApp()
  const [b, setB] = useState<Buddy | null | undefined>(undefined)
  const [ms, setMs] = useState<Member[] | null>(null)
  const [mode, setMode] = useState<null | 'new' | 'join'>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const load = async () => {
    const x = await getBuddy()
    setB(x)
    if (x) { await pushCard().catch(() => {}); setMs(await members().catch((e) => { setErr((e as Error).message); return [] })) }
  }
  useEffect(() => { load() }, [])
  if (b === undefined) return null
  if (!b) return (
    <div className="card buddy">
      <p className="small muted">几个朋友一起学：只互相看本周练了几天，不排行、不比分数。</p>
      {mode ? (
        <div className="buddy-form">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="组里怎么称呼你（比如 小林）" maxLength={16} />
          {mode === 'join' && <input className="input sync-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="朋友给你的小组码" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />}
          <div className="row">
            <button className="btn small ghost" onClick={() => setMode(null)}>取消</button>
            <button className="btn small primary" disabled={!name.trim() || (mode === 'join' && !validCode(code))} onClick={async () => {
              try { await joinGroup(name, mode === 'join' ? code : undefined); setMode(null); await load(); toast(mode === 'new' ? '小组建好了，把小组码发给朋友' : '已加入') } catch (e) { toast((e as Error).message) }
            }}>{mode === 'new' ? '建小组' : '加入'}</button>
          </div>
        </div>
      ) : (
        <div className="row"><button className="btn small quiet" onClick={() => setMode('new')}>建一个小组</button><button className="btn small quiet" onClick={() => setMode('join')}>我有小组码</button></div>
      )}
    </div>
  )
  return (
    <div className="card buddy">
      {err && <p className="small muted">{err}</p>}
      <ul className="buddy-list">
        {(ms ?? []).map((m) => (
          <li key={m.id}><b>{m.name}{m.me ? '（我）' : ''}</b><span className="dots" aria-label={`本周练了 ${m.lit} 天`}>{Array.from({ length: 7 }, (_, i) => <i key={i} className={i < m.lit ? 'on' : ''} />)}</span><span className="small muted">{m.lit}/{m.goal}{m.streak > 1 ? ` · 连续 ${m.streak} 周` : ''}</span></li>
        ))}
      </ul>
      <div className="row" style={{ marginTop: 10 }}>
        <span className="small muted">小组码 <span className="en">{b.code}</span></span>
        <div className="spacer" />
        <button className="btn small ghost" onClick={async () => { try { await navigator.clipboard.writeText(b.code); toast('小组码已复制，发给朋友') } catch { toast('复制不了，手动抄一下') } }}>复制</button>
        <button className="btn small ghost" onClick={async () => { if (confirm('退出这个小组？')) { await leaveGroup(); setMs(null); setB(null) } }}>退出</button>
      </div>
    </div>
  )
}

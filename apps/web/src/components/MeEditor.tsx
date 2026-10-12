// 剧里的“你”：名字 + 声音。预配名字有完整配音；自己填的名字，别人叫你名字的那几句改用系统朗读
import { useState } from 'react'
import { useApp } from '../store'
import { cleanName, presetOf, PRESET_NAMES, setMe, type Me } from '../lib/episodes'
import { play } from '../lib/tts'
import { Sheet } from './Sheet'

export function MeEditor({ me, onClose }: { me: Me; onClose: () => void }) {
  const { refresh, toast, profile } = useApp()
  const [name, setName] = useState(me.name)
  const [voice, setVoice] = useState<Me['voice']>(me.voice)
  const [typed, setTyped] = useState(presetOf(me.name) || me.name === 'Lin' ? '' : me.name)
  const custom = typed.trim() ? cleanName(typed) : null
  const final = typed.trim() ? custom : name

  const save = async () => {
    if (!final) { toast('名字只能用英文字母，最多 16 个'); return }
    await setMe({ name: final, voice })
    refresh()
    toast(`好的，剧里的你叫 ${final}`)
    onClose()
  }
  // 试听第一季第一集开头：你说一句，Emma 叫你的名字（列表外的名字没有配音，就不试听了）
  const sample = presetOf(final ?? '') ?? (final === 'Lin' ? 'Lin' : null)
  const listen = async () => {
    if (!sample || !profile) return
    const m = voice === 'm' ? '.m' : ''
    try {
      await play({ text: "Excuse me, I think my key doesn't work.", ep: `s1e1-0${m}` }, profile.accent)
      await play({ text: `Oh, you must be ${sample}! I'm Emma, your new flatmate.`, ep: sample === 'Lin' ? 's1e1-1' : `s1e1-1.n-${sample.toLowerCase()}` }, profile.accent)
    } catch { toast('配音还没准备好，稍后再试') }
  }

  return (
    <Sheet onClose={onClose} className="me-editor">
        <h2>剧里的你</h2>
        <p className="small muted" style={{ marginTop: 4 }}>剧集里你是主角。选一个英文名，别人会这样叫你；声音是“演”的时候给你示范的声音。</p>

        <p className="section-title">名字</p>
        <div className="chips">
          {['Lin', ...PRESET_NAMES].map((n) => (
            <button key={n} className="chip" aria-pressed={!typed.trim() && name === n} onClick={() => { setName(n); setTyped('') }}>{n === 'Lin' ? 'Lin（林）' : n}</button>
          ))}
        </div>
        <input className="input" style={{ marginTop: 10 }} placeholder="或者填你自己的英文名" value={typed} maxLength={16} onChange={(e) => setTyped(e.target.value)} />
        {typed.trim() && (
          <p className="small" style={{ marginTop: 6, color: custom ? 'var(--soft)' : 'var(--bad)' }}>
            {!custom ? '只能用英文字母' : presetOf(custom) ? '这个名字有配音' : '这个名字没有预先配音：别人叫你名字的那几句会改用系统朗读'}
          </p>
        )}

        <p className="section-title">你的声音</p>
        <div className="seg">
          <button aria-pressed={voice === 'f'} onClick={() => setVoice('f')}>女声</button>
          <button aria-pressed={voice === 'm'} onClick={() => setVoice('m')}>男声</button>
        </div>

        <div className="row" style={{ marginTop: 20, gap: 8 }}>
          {sample && <button className="btn quiet" onClick={listen}>试听</button>}
          <button className="btn primary" style={{ flex: 1 }} disabled={!final} onClick={save}>保存</button>
        </div>
    </Sheet>
  )
}

// 声音日记：每周读一遍同一段话。最上面是这段话，下面录音；录过的每周一行，能和第一周对着听
import { useEffect, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { Recorder } from '../components/Recorder'
import { Icon } from '../components/icons'
import { PlayButton } from '../components/PlayButton'
import { useApp } from '../store'
import { PASSAGE, entries, playEntry, saveEntry, stopEntry, type Entry } from '../lib/voice-diary'
import { weekStart } from '../lib/rhythm'
import { today } from '../lib/db'

const md = (week: string) => { const d = new Date(week + 'T12:00:00'); return `${d.getMonth() + 1}/${d.getDate()} 那周` }

function Play({ id }: { id: number }) {
  const [on, setOn] = useState(false)
  return <button className={`icon-btn ${on ? 'playing' : ''}`} aria-label="播放这次录音" onClick={async () => { if (on) { stopEntry(); return } setOn(true); try { await playEntry(id) } finally { setOn(false) } }}>{on ? <Icon.stop /> : <Icon.play />}</button>
}

export function VoiceDiary({ onClose }: { onClose: () => void }) {
  const { profile, refresh, toast } = useApp()
  const [list, setList] = useState<Entry[] | null>(null)
  const load = () => entries().then(setList)
  useEffect(() => { load(); return () => stopEntry() }, [])
  if (!list || !profile) return null
  const week = weekStart(today())
  const mine = list.find((e) => e.week === week)
  const first = list[0]
  const n = list.length

  return (
    <Overlay title="声音日记" sub="每周用同一段话录一次，听自己的变化" onClose={() => { refresh(); onClose() }}>
      <div className="fade-in voice-diary">
        <div className="card">
          <p className="en passage">{PASSAGE.en}</p>
          <p className="small muted" style={{ marginTop: 8 }}>{PASSAGE.zh}</p>
          <div className="row" style={{ marginTop: 10 }}><span className="small muted">先听一遍示范</span><div className="spacer" /><PlayButton text={PASSAGE.en} accent={profile.accent} /></div>
        </div>

        <Recorder hint={mine ? '本周录过了，再录一次会替换掉' : '不用急，照平时的语速读完再点一下'} onAudio={async (a) => {
          if (a.length < 16000 * 5) { toast('太短了，把整段读完再停'); return }
          const e = await saveEntry(a)
          await load()
          toast(e.score != null ? `存好了 · 发音 ${e.score} 分` : '存好了')
        }} />

        {n > 0 && (
          <>
            <p className="section-title">{n > 1 ? `录了 ${n} 周` : '第一次录音'}</p>
            {n > 1 && mine && first && first.id !== mine.id && (
              <div className="card compare">
                <p className="small muted">第一周 → 这周</p>
                <div className="row"><Play id={first.id} /><span className="small">{md(first.week)}{first.score != null ? ` · ${first.score} 分` : ''}{first.wpm ? ` · 每分钟 ${Math.round(first.wpm)} 词` : ''}</span></div>
                <div className="row"><Play id={mine.id} /><span className="small"><b>这周</b>{mine.score != null ? ` · ${mine.score} 分` : ''}{mine.wpm ? ` · 每分钟 ${Math.round(mine.wpm)} 词` : ''}</span></div>
              </div>
            )}
            <div className="list">
              {[...list].reverse().map((e) => (
                <div className="set-row" key={e.id}>
                  <div className="k"><b>{e.week === week ? '这周' : md(e.week)}</b><span>{[e.score != null && `发音 ${e.score} 分`, e.wpm && `每分钟 ${Math.round(e.wpm)} 词`, e.pauses != null && `停顿 ${e.pauses} 次`, `${Math.round(e.sec)} 秒`].filter(Boolean).join(' · ')}</span></div>
                  <Play id={e.id} />
                </div>
              ))}
            </div>
          </>
        )}
        {n === 0 && <p className="small muted" style={{ textAlign: 'center' }}>这是第 1 周。过几周回来听，会听到明显的不同。</p>}
      </div>
    </Overlay>
  )
}

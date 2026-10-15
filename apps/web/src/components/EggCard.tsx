// 每日彩蛋卡片：没开时是一个“开彩蛋”按钮，点开翻出内容（可以朗读、点词查义）
import { useEffect, useState } from 'react'
import { EGG_KIND, openEgg, todayEgg, type Egg } from '../lib/eggs'
import { PlayButton } from './PlayButton'
import { Tappable } from './Tappable'
import { useApp } from '../store'

export function EggCard() {
  const { profile } = useApp()
  const [st, setSt] = useState<{ egg: Egg | null; opened: boolean } | null>(null)
  useEffect(() => { todayEgg().then(setSt).catch(() => {}) }, [])
  if (!st?.egg || !profile) return null
  const e = st.egg
  if (!st.opened) return (
    <button className="card egg closed" onClick={async () => { await openEgg(e.id); setSt({ egg: e, opened: true }) }}>
      <span className="egg-mark" aria-hidden>?</span>
      <span><b>今天的彩蛋</b><span className="small muted">练完了，开一个看看是什么</span></span>
    </button>
  )
  return (
    <div className="card egg open fade-in">
      <span className="small muted">今天的彩蛋 · {EGG_KIND[e.kind]}</span>
      <div className="row"><p className="en egg-en"><Tappable text={e.en} /></p><div className="spacer" /><PlayButton text={e.en} accent={profile.accent} /></div>
      <p className="egg-zh">{e.zh}</p>
      <p className="small muted">{e.note_zh}</p>
    </div>
  )
}

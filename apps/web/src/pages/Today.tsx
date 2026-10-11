import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../components/icons'
import { dayRow, recentDays, sizeFor, type DayRow } from '../lib/lesson'
import { dueCount } from '../lib/srs'
import { currentLevel } from '../lib/progress'
import { eta, goalLabel, type Cefr } from '../lib/levels'

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

export function Today({ onStart }: { onStart: (minimum: boolean) => void }) {
  const { profile, tick } = useApp()
  const [d, setD] = useState<DayRow | null>(null)
  const [due, setDue] = useState(0)
  const [week, setWeek] = useState<DayRow[]>([])
  const [lv, setLv] = useState<{ cefr: Cefr; vocab: number } | null>(null)
  useEffect(() => {
    dayRow().then(setD)
    dueCount().then(setDue)
    recentDays(7).then(setWeek)
    if (profile) currentLevel(profile).then(setLv)
  }, [tick, profile])
  if (!profile || !d) return <div className="loading">…</div>
  const size = sizeFor(profile.minutes)
  const rv = { done: Math.min(d.reviews, size.review), want: Math.min(size.review, d.reviews + due) }
  const items = [
    { k: 'review', ico: <Icon.review />, t: '复习', s: rv.want ? '到期的词，趁快忘之前' : '今天没有到期的词', n: `${rv.done}/${rv.want}`, done: rv.want > 0 && rv.done >= rv.want },
    { k: 'new', ico: <Icon.plus />, t: '新词', s: '带例句和发音', n: `${Math.min(d.new_words, size.fresh)}/${size.fresh}`, done: d.new_words >= size.fresh },
    { k: 'shadow', ico: <Icon.mic />, t: '跟读', s: '逐个音标打分', n: `${Math.min(d.shadows, size.shadow)}/${size.shadow}`, done: d.shadows >= size.shadow },
  ]
  const allDone = items.every((x) => x.done || (x.k === 'review' && rv.want === 0))
  const e = lv ? eta(lv.cefr, profile.goal.target, profile.minutes, profile.start) : null
  const now = new Date()

  return (
    <div className="page fade-in">
      <div className="page-head">
        <h1>今天</h1>
        <span className="small muted">{now.getMonth() + 1} 月 {now.getDate()} 日 · 星期{WEEK[now.getDay()]}</span>
      </div>

      <div className="card raised today-card">
        {allDone ? (
          <div className="done-banner">
            <span className="big" aria-hidden>🌱</span>
            <div><b>今天的练习完成了</b><p className="small muted">明天到期的词会自动排好。想多练可以再来一组。</p></div>
          </div>
        ) : (
          <div><b style={{ fontSize: 18 }}>今日练习</b><p className="small muted">约 {profile.minutes} 分钟，做完一项算一项</p></div>
        )}
        <ul className="today-list">
          {items.map((x) => (
            <li key={x.k} className={x.done ? 'done' : ''}>
              <span className="ico">{x.done ? <Icon.check /> : x.ico}</span>
              <span className="t"><b>{x.t}</b><span>{x.s}</span></span>
              <span className="n">{x.n}</span>
            </li>
          ))}
        </ul>
        <button className="btn primary block" onClick={() => onStart(false)}>{allDone ? '再来一组' : d.reviews + d.new_words + d.shadows > 0 ? '继续' : '开始'}</button>
        {!allDone && <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => onStart(true)}>今天很忙，只做 2 分钟</button>}
      </div>

      {lv && e && (
        <>
          <p className="section-title">离目标</p>
          <div className="card">
            <p className="level-line">现在 <b>{lv.cefr}</b>（约 {lv.vocab.toLocaleString()} 词，估算）→ 目标 <b>{goalLabel(profile.goal)}</b>（{profile.goal.target}）</p>
            <div className="bar" style={{ margin: '12px 0 8px' }}><i style={{ width: `${Math.round(e.progress * 100)}%` }} /></div>
            <p className="small muted">{e.hoursLeft === 0 ? '词汇量已经达标，接下来重点练听说。' : `已走完 ${Math.round(e.progress * 100)}% · 按每天 ${profile.minutes} 分钟，预计 ${e.date} 到达`}</p>
          </div>
        </>
      )}

      <p className="section-title">最近 7 天</p>
      <div className="card">
        <div className="week">
          {week.map((w, i) => {
            const dt = new Date(Date.now() - (6 - i) * 86400_000)
            const any = w.reviews + w.new_words + w.shadows > 0
            return (
              <div key={w.date}>
                <div className="d">{WEEK[dt.getDay()]}</div>
                <div className={`dot ${w.done ? 'done' : any ? 'min' : ''} ${i === 6 ? 'today' : ''}`}>{w.done ? '✓' : any ? '·' : dt.getDate()}</div>
              </div>
            )
          })}
        </div>
        <p className="small faint" style={{ marginTop: 12 }}>漏了也没关系，不扣分、不清零。</p>
      </div>
    </div>
  )
}

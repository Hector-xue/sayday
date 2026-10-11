import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { currentLevel, scoreTrend, stats, weakPhones } from '../lib/progress'
import { recentDays, type DayRow } from '../lib/lesson'
import { CEFR, eta, goalLabel, ieltsLabel, nextCefr, vocabFloor, type Cefr } from '../lib/levels'
import { HINT } from '../components/Shadow'

export function Progress() {
  const { profile, tick } = useApp()
  const [lv, setLv] = useState<{ cefr: Cefr; vocab: number; learned: number } | null>(null)
  const [st, setSt] = useState<Awaited<ReturnType<typeof stats>> | null>(null)
  const [weak, setWeak] = useState<Awaited<ReturnType<typeof weakPhones>>>([])
  const [days, setDays] = useState<DayRow[]>([])
  const [trend, setTrend] = useState<Awaited<ReturnType<typeof scoreTrend>>>([])
  useEffect(() => {
    if (!profile) return
    currentLevel(profile).then(setLv); stats().then(setSt); weakPhones().then(setWeak); recentDays(7).then(setDays); scoreTrend().then(setTrend)
  }, [tick, profile])
  if (!profile || !lv || !st) return <div className="loading">…</div>
  const e = eta(lv.cefr, profile.goal.target, profile.minutes, profile.start)
  const nxt = nextCefr(lv.cefr)
  const maxMin = Math.max(5, ...days.map((d) => d.seconds / 60))
  const iStart = CEFR.indexOf(profile.start), iNow = CEFR.indexOf(lv.cefr), iGoal = CEFR.indexOf(profile.goal.target)

  return (
    <div className="page fade-in">
      <div className="page-head"><h1>进步</h1></div>
      <div className="card raised">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div><p className="small muted">现在（估算）</p><div className="report-level" style={{ fontSize: 44 }}>{lv.cefr}</div></div>
          <div className="spacer" />
          <div style={{ textAlign: 'right' }}><p className="small muted">目标 {goalLabel(profile.goal)}</p><b style={{ fontSize: 20 }}>{profile.goal.target}</b></div>
        </div>
        <div className="bar" style={{ margin: '14px 0 8px' }}><i style={{ width: `${Math.round(e.progress * 100)}%` }} /></div>
        <p className="small muted">{e.hoursLeft ? `已走完 ${Math.round(e.progress * 100)}% · 预计 ${e.date} 到达 · 雅思参考 ${ieltsLabel(lv.cefr)}` : '词汇量已达到目标档位'}</p>
        {nxt && <p className="small" style={{ marginTop: 10 }}>下一个里程碑：再认识约 <b>{Math.max(0, vocabFloor(nxt) - lv.vocab).toLocaleString()}</b> 个词 → 升 {nxt}</p>}
      </div>

      <p className="section-title">词汇阶梯</p>
      <div className="card ladder">
        {CEFR.slice(1).map((c) => {
          const i = CEFR.indexOf(c)
          const fill = i <= iNow ? 100 : i === iNow + 1 && nxt ? Math.round(((lv.vocab - vocabFloor(lv.cefr)) / Math.max(1, vocabFloor(nxt) - vocabFloor(lv.cefr))) * 100) : 0
          return (
            <div className="rung" key={c}>
              <b style={{ color: i === iGoal ? 'var(--brand)' : undefined }}>{c}{i === iGoal ? ' 🎯' : ''}</b>
              <div className="track"><i style={{ width: `${Math.max(0, Math.min(100, fill))}%`, opacity: i < iStart ? 0.4 : 1 }} /></div>
            </div>
          )
        })}
      </div>

      <p className="section-title">练习</p>
      <div className="stat-grid">
        <div className="card stat"><b>{st.days}</b><span>练习过的天数</span></div>
        <div className="card stat"><b>{lv.learned}</b><span>记住的新词</span></div>
        <div className="card stat"><b>{st.reviews}</b><span>次复习</span></div>
        <div className="card stat"><b>{st.recentScore ?? '—'}</b><span>最近跟读平均分</span></div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="small muted">最近 7 天练习时长（分钟）</p>
        <div className="chart">
          {days.map((d) => (
            <div className="col" key={d.date}><i style={{ height: `${(d.seconds / 60 / maxMin) * 100}%` }} /><span>{d.date.slice(8)}</span></div>
          ))}
        </div>
      </div>

      <p className="section-title">发音弱项</p>
      <div className="card">
        {weak.length === 0 ? <p className="small muted">跟读多几句就能看出来（每个音至少练 5 次）。</p> : (
          <ul className="tips" style={{ margin: 0, background: 'none', padding: 0 }}>
            {weak.map((w) => (
              <li key={w.phone}><b>/{w.phone.toLowerCase()}/</b>{HINT[w.phone] ?? '多听示范，注意口型'}<span className="faint small"> · 练过 {w.n} 次，{Math.round((w.bad / w.n) * 100)}% 没读准</span></li>
            ))}
          </ul>
        )}
        {trend.length > 1 && <p className="small muted" style={{ marginTop: 12 }}>跟读分数：{trend.map((t) => Math.round(t.avg)).join(' → ')}</p>}
      </div>
    </div>
  )
}

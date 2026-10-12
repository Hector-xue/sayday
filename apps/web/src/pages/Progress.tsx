import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { currentLevel, scoreTrend, stats, weakPhones } from '../lib/progress'
import { recentDays, type DayRow } from '../lib/lesson'
import { CEFR, eta, goalLabel, ieltsLabel, nextCefr, vocabFloor, type Cefr } from '../lib/levels'
import { HINT } from '../components/Shadow'
import { listenLevel, type ListenLevel } from '../lib/calibrate'
import { recordingPairs, playRecording, type Pair } from '../lib/recordings'
import { lastTests } from '../lib/ielts'
import { writingHistory } from '../lib/writing'
import { practiceBand } from '../lib/practice'
import { db } from '../lib/db'
import { Icon } from '../components/icons'
import { ipa } from '../lib/phones'

const SRC: Record<string, string> = { placement: '入门定级', manual: '手动选择', weekly: '每周小测' }
const md = (ts: number) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}` }

function PlayRec({ id }: { id: number }) {
  const [on, setOn] = useState(false)
  return <button className={`icon-btn ${on ? 'playing' : ''}`} aria-label="播放录音" onClick={async () => { setOn(true); try { await playRecording(id) } finally { setOn(false) } }}>{on ? <Icon.stop /> : <Icon.play />}</button>
}

export function Progress({ onSettings }: { onSettings: () => void }) {
  const { profile, tick } = useApp()
  const [lv, setLv] = useState<{ cefr: Cefr; vocab: number; learned: number } | null>(null)
  const [st, setSt] = useState<Awaited<ReturnType<typeof stats>> | null>(null)
  const [weak, setWeak] = useState<Awaited<ReturnType<typeof weakPhones>>>([])
  const [days, setDays] = useState<DayRow[]>([])
  const [trend, setTrend] = useState<Awaited<ReturnType<typeof scoreTrend>>>([])
  const [ll, setLl] = useState<ListenLevel | null>(null)
  const [hist, setHist] = useState<{ cefr: string; value: number; source: string; ts: number }[]>([])
  const [pairs, setPairs] = useState<Pair[]>([])
  const [wband, setWband] = useState<{ band: number; ts: number } | null>(null)
  const [pb, setPb] = useState<{ r: Awaited<ReturnType<typeof practiceBand>>; l: Awaited<ReturnType<typeof practiceBand>> }>({ r: null, l: null })
  const [mock, setMock] = useState<{ band: number | null; fc: number | null; p: number | null; ts: number } | null>(null)
  useEffect(() => {
    if (!profile) return
    currentLevel(profile).then(setLv); stats().then(setSt); weakPhones().then(setWeak); recentDays(7).then(setDays); scoreTrend().then(setTrend)
    listenLevel().then(setLl); recordingPairs().then(setPairs)
    Promise.all([practiceBand('reading'), practiceBand('listening')]).then(([r, l]) => setPb({ r, l }))
    writingHistory(10).then((h) => { const x = h.find((r) => r.band !== null); setWband(x ? { band: x.band!, ts: x.ts } : null) })
    lastTests(1).then((r) => { if (r[0]) { const d = JSON.parse(r[0].data); setMock({ band: r[0].band, fc: d.grade?.fc ?? d.objective?.fc ?? null, p: d.grade?.p ?? d.objective?.p ?? null, ts: r[0].ts }) } })
    db.all<{ cefr: string; value: number; source: string; ts: number }>("SELECT cefr, value, source, ts FROM level_estimate WHERE skill = 'vocab' ORDER BY ts DESC LIMIT 8").then(setHist)
  }, [tick, profile])
  if (!profile || !lv || !st) return <div className="loading">…</div>
  const e = eta(lv.cefr, profile.goal.target, profile.minutes, profile.start)
  const nxt = nextCefr(lv.cefr)
  const maxMin = Math.max(5, ...days.map((d) => d.seconds / 60))
  const iStart = CEFR.indexOf(profile.start), iNow = CEFR.indexOf(lv.cefr), iGoal = CEFR.indexOf(profile.goal.target)

  return (
    <div className="page fade-in">
      <div className="page-head"><h1>进步</h1><button className="icon-btn ghost" aria-label="设置" onClick={onSettings}><Icon.settings /></button></div>
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

      <p className="section-title">分项</p>
      <div className="list">
        <div className="set-row"><div className="k"><b>词汇</b><span>约 {lv.vocab.toLocaleString()} 词 · 每学会一个词都算上</span></div><b className="skill-lv">{lv.cefr}</b></div>
        <div className="set-row"><div className="k"><b>听力</b><span>{ll && ll.cefr ? `听音选义 ${ll.n} 题，正确率 ${Math.round(ll.acc * 100)}%` : (ll?.n ?? 0) >= 6 ? `做了 ${ll!.n} 题，正确率 ${Math.round(ll!.acc * 100)}%，某一档稳定答对七成就出结果` : `每天练习里的听力题，再做 ${6 - (ll?.n ?? 0)} 题以上出结果`}</span></div><b className="skill-lv">{ll?.cefr ?? '—'}</b></div>
        <div className="set-row"><div className="k"><b>口语（模考）</b><span>{mock ? `${new Date(mock.ts).toLocaleDateString()} · ${mock.band !== null ? 'AI 四项评分' : `流利 ${mock.fc ?? '—'} · 发音 ${mock.p ?? '—'}（参考）`}` : '在“今天 → 雅思专项”或“发音”页做一次口语模考'}</span></div><b className="skill-lv">{mock?.band?.toFixed(1) ?? '—'}</b></div>
        {(pb.r || pb.l) && <div className="set-row"><div className="k"><b>雅思听力 / 阅读</b><span>最近几次练习按比例折算{pb.l ? ` · 听力 ${pb.l.n} 题` : ''}{pb.r ? ` · 阅读 ${pb.r.n} 题` : ''}</span></div><b className="skill-lv">{pb.l?.band.toFixed(1) ?? '—'} / {pb.r?.band.toFixed(1) ?? '—'}</b></div>}
        <div className="set-row"><div className="k"><b>写作</b><span>{wband ? `${new Date(wband.ts).toLocaleDateString()} · AI 四项评分` : '在“今天 → 雅思专项 → 写作”写一篇'}</span></div><b className="skill-lv">{wband?.band.toFixed(1) ?? '—'}</b></div>
        <div className="set-row"><div className="k"><b>发音</b><span>{st.recentScore !== null ? '最近 20 句跟读的平均分' : '跟读几句就有'}</span></div><b className="skill-lv">{st.recentScore ?? '—'}</b></div>
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
              <li key={w.phone}><b>/{ipa(w.phone)}/</b>{HINT[w.phone] ?? '多听示范，注意口型'}<span className="faint small"> · 练过 {w.n} 次，{Math.round((w.bad / w.n) * 100)}% 没读准</span></li>
            ))}
          </ul>
        )}
        {trend.length > 1 && <p className="small muted" style={{ marginTop: 12 }}>跟读分数：{trend.map((t) => Math.round(t.avg)).join(' → ')}</p>}
      </div>

      <p className="section-title">录音对比</p>
      <div className="card">
        {pairs.length === 0 ? <p className="small muted">同一句读过两次以上（隔几天再遇到时），这里能听到第一次和最近一次的差别。</p> : (
          <div className="pairs">
            {pairs.map((p) => (
              <div className="pair" key={p.text}>
                <p className="en">{p.text}</p>
                <div className="row">
                  <PlayRec id={p.first.id} /><span className="small muted">{md(p.first.ts)} · {p.first.score} 分</span>
                  <div className="spacer" />
                  <span className="small">{md(p.last.ts)} · <b>{p.last.score}</b> 分</span><PlayRec id={p.last.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {hist.length > 0 && (
        <>
          <p className="section-title">水平记录</p>
          <div className="list">
            {hist.map((h, i) => (
              <div className="set-row" key={i}><div className="k"><b>{h.cefr} · 约 {Math.round(h.value).toLocaleString()} 词</b><span>{new Date(h.ts).toLocaleDateString()} · {SRC[h.source] ?? h.source}</span></div></div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

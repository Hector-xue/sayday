import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../components/icons'
import { dailySize, dayRow, recentDays, type DayRow } from '../lib/lesson'
import { weeklyDue } from '../lib/calibrate'
import { db, today } from '../lib/db'
import { getAi } from '../lib/ai'
import { getProgress, loadSeasons, nextUp, teaserFor } from '../lib/episodes'
import { dueCount } from '../lib/srs'
import { currentLevel } from '../lib/progress'
import { eta, goalLabel, type Cefr } from '../lib/levels'
import { currentStreak } from '../lib/widget'

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

export function Today({ onStart, onRetest, onAi, onEpisode, onSettings, onIelts }: { onStart: (minimum: boolean) => void; onRetest: () => void; onAi: (k: 'setup' | 'chat' | 'diary' | 'writing') => void; onEpisode: (id: { season: number; ep: number }) => void; onSettings: () => void; onIelts: (k: 'reading' | 'listening' | 'speaking') => void }) {
  const { profile, tick } = useApp()
  const [d, setD] = useState<DayRow | null>(null)
  const [due, setDue] = useState(0)
  const [week, setWeek] = useState<DayRow[]>([])
  const [lv, setLv] = useState<{ cefr: Cefr; vocab: number } | null>(null)
  const [size, setSize] = useState<Awaited<ReturnType<typeof dailySize>> | null>(null)
  const [check, setCheck] = useState(false)
  const [retest, setRetest] = useState(false)
  const [hasAi, setHasAi] = useState(false)
  const [wrote, setWrote] = useState(false)
  const [chatted, setChatted] = useState(false)
  const [ep, setEp] = useState<ReturnType<typeof nextUp> | null>(null)
  const [prevTeaser, setPrevTeaser] = useState('')
  const [streak, setStreak] = useState(0)
  useEffect(() => {
    if (profile) {
      dailySize(profile).then(setSize)
      weeklyDue(profile).then(setCheck)
      // 每月可选一次完整复测：离上次完整定级满 30 天
      db.one<{ ts: number }>("SELECT max(ts) ts FROM level_estimate WHERE source IN ('placement', 'manual')").then((r) => setRetest(Date.now() - (r?.ts ?? Date.now()) > 30 * 86400_000))
    }
    getAi().then((c) => setHasAi(!!c))
    Promise.all([loadSeasons(), getProgress()]).then(([all, p]) => { const u = nextUp(all, p); setEp(u); setPrevTeaser(teaserFor(all, u.season.season, u.ep.id)) })
    db.one<{ n: number }>('SELECT count(*) n FROM diary WHERE date = ? AND result IS NOT NULL', [today()]).then((r) => setWrote(!!r?.n))
    db.one<{ n: number }>("SELECT count(*) n FROM chat WHERE role = 'user' AND ts > ?", [Date.now() - 18 * 3600_000]).then((r) => setChatted(!!r?.n))
    dayRow().then(setD)
    dueCount().then(setDue)
    recentDays(7).then(setWeek)
    currentStreak().then(setStreak)
    if (profile) currentLevel(profile).then(setLv)
  }, [tick, profile])
  if (!profile || !d || !size) return <div className="loading">…</div>
  const rv = { done: Math.min(d.reviews, size.review), want: Math.min(size.review, d.reviews + due) }
  const items = [
    { k: 'review', ico: <Icon.review />, t: '复习', s: rv.want ? '到期的词，趁快忘之前' : '今天没有到期的词', n: `${rv.done}/${rv.want}`, done: rv.want > 0 && rv.done >= rv.want },
    { k: 'new', ico: <Icon.plus />, t: '新词', s: '带例句和发音', n: `${Math.min(d.new_words, size.fresh)}/${size.fresh}`, done: d.new_words >= size.fresh },
    { k: 'listen', ico: <Icon.ear />, t: '听力', s: '听一句，选意思', n: `${Math.min(d.listens, size.listen)}/${size.listen}`, done: d.listens >= size.listen },
    { k: 'shadow', ico: <Icon.mic />, t: '跟读', s: '逐个音标打分', n: `${Math.min(d.shadows, size.shadow)}/${size.shadow}`, done: d.shadows >= size.shadow },
  ]
  const allDone = items.every((x) => x.done || (x.k === 'review' && rv.want === 0))
  const e = lv ? eta(lv.cefr, profile.goal.target, profile.minutes, profile.start) : null
  const now = new Date()

  return (
    <div className="page fade-in">
      <div className="page-head">
        <h1>今天</h1>
        <span className="row"><span className="small muted">{now.getMonth() + 1} 月 {now.getDate()} 日 · 星期{WEEK[now.getDay()]}</span><button className="icon-btn ghost" aria-label="设置" onClick={onSettings}><Icon.settings /></button></span>
      </div>

      <div className="streak-hero">
        <div className="streak-num"><b>{streak}</b><span>{streak ? '天连续' : '今天开个头'}</span></div>
        <div className="week">
          {week.map((w, i) => {
            const dt = new Date(Date.now() - (6 - i) * 86400_000)
            const any = w.reviews + w.new_words + w.shadows + w.listens > 0
            return (
              <div key={w.date}>
                <div className="d">{WEEK[dt.getDay()]}</div>
                <div className={`dot ${w.done ? 'done' : any ? 'min' : ''} ${i === 6 ? 'today' : ''}`}>{w.done ? '✓' : any ? '·' : dt.getDate()}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card raised today-card">
        {allDone ? (
          <div className="done-banner">
            <span className="big" aria-hidden><Icon.sprout /></span>
            <div><b>今天的练习完成了</b><p className="small muted">明天到期的词会自动排好。想多练可以再来一组。</p></div>
          </div>
        ) : (
          <div><b style={{ fontSize: 18 }}>今日练习</b><p className="small muted">约 {profile.minutes} 分钟，做完一项算一项{check ? ' · 今天先做 1 分钟每周小测' : ''}</p></div>
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
        <button className="btn primary block" onClick={() => onStart(false)}>{allDone ? '再来一组' : d.reviews + d.new_words + d.shadows + d.listens > 0 ? '继续' : '开始'}</button>
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

      {ep && ep.state !== 'all-done' && (
        <>
          <p className="section-title">今日剧集</p>
          <button className="card ai-card wide ep-today" onClick={() => ep.state === 'ready' && onEpisode({ season: ep.season.season, ep: ep.ep.id })} disabled={ep.state !== 'ready'}>
            <span className="small muted">{ep.season.season > 1 ? `第 ${ep.season.season} 季 ` : ''}第 {ep.ep.id} 集 · {ep.state === 'ready' ? ep.ep.level : '明天解锁'}</span>
            <b className="en" style={{ fontSize: 18 }}>{ep.ep.title}</b>
            <span>{ep.state === 'ready' ? ep.ep.scene_zh : prevTeaser}</span>
          </button>
        </>
      )}

      {profile.goal.kind === 'ielts' && (
        <>
          <p className="section-title">雅思专项</p>
          <div className="ai-grid">
            <button className="card ai-card" onClick={() => onIelts('listening')}>
              <span className="ai-ico"><Icon.headphones /></span><b>听力</b><span>四个部分，和真考一样只放一遍</span>
            </button>
            <button className="card ai-card" onClick={() => onIelts('reading')}>
              <span className="ai-ico"><Icon.book /></span><b>阅读</b><span>学术类文章，判断、填空、配对</span>
            </button>
            <button className="card ai-card" onClick={() => onIelts('speaking')}>
              <span className="ai-ico"><Icon.speak /></span><b>口语模考</b><span>三个部分完整走一遍</span>
            </button>
            <button className="card ai-card" onClick={() => onAi('writing')}>
              <span className="ai-ico"><Icon.pen /></span><b>写作</b><span>{hasAi ? '大作文 / 书信，AI 批改' : '需要先接入 AI'}</span>
            </button>
          </div>
        </>
      )}

      <p className="section-title">说和写</p>
      {hasAi ? (
        <div className="ai-grid">
          <button className="card ai-card" onClick={() => onAi('chat')}>
            <span className="ai-ico"><Icon.chat /></span><b>和 Emma 聊几句</b><span>{chatted ? '今天聊过了，还可以接着聊' : '伦敦的室友，按你的水平说话'}</span>
          </button>
          <button className="card ai-card" onClick={() => onAi('diary')}>
            <span className="ai-ico"><Icon.diary /></span><b>写今天的日记</b><span>{wrote ? '今天写过了 ✓' : '写几句，AI 帮你改'}</span>
          </button>
        </div>
      ) : (
        <button className="card ai-card wide" onClick={() => onAi('setup')}>
          <b>接入你自己的 AI</b><span>解锁陪练聊天和日记批改。DeepSeek、通义、Kimi、智谱等都可以，密钥只存在这台设备上</span>
        </button>
      )}

      {retest && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row"><div><b>满一个月了</b><p className="small muted">可以重新测一次词汇量，看看这个月的变化（约 3 分钟，可不做）</p></div><div className="spacer" /><button className="btn small quiet" onClick={onRetest}>去测</button></div>
        </div>
      )}

    </div>
  )
}

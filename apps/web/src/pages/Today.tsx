import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../components/icons'
import { dailySize, dayRow, type DayRow } from '../lib/lesson'
import { weeklyDue } from '../lib/calibrate'
import { db } from '../lib/db'
import { getAi } from '../lib/ai'
import { getProgress, loadSeasons, nextUp, teaserFor } from '../lib/episodes'
import { dueCount } from '../lib/srs'
import { stats } from '../lib/progress'
import { comeback, currentWeek, spreadBacklog, type Comeback, type Week } from '../lib/rhythm'
import { checkUpdate, type UpdateInfo } from '../lib/update'
import { UpdateCard } from '../components/UpdateCard'
import { SupportSheet } from '../components/SupportSheet'
import { ModelPrefetchBar } from '../components/ModelPrefetch'
import { getSupport, shouldPrompt, type SupportState } from '../lib/support'
import { markAbilitiesSeen, unseenAbilities, type Ability } from '../lib/growth'
import { thisWeek } from '../lib/voice-diary'
import { VoiceDiary } from './VoiceDiary'
import { EggCard } from '../components/EggCard'
import { nudge, shouldNudge, unreadNudge, type Nudge } from '../lib/companion'
import { vocabLevel } from '../lib/calibrate'
import { nextMilestone, type Milestone } from '../lib/milestones'
import { Celebrate } from '../components/Celebrate'
import { todayHeard } from '../lib/listen'
import { player, recallNow, syncHeard, type PlayState } from '../lib/listen-player'

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

export function Today({ onStart, onRetest, onAi, onEpisode, onSettings, onListen }: { onStart: (minimum: boolean, comeback?: boolean) => void; onRetest: () => void; onAi: (k: 'chat') => void; onEpisode: (id: { season: number; ep: number }) => void; onSettings: () => void; onListen: () => void }) {
  const { profile, tick } = useApp()
  const [d, setD] = useState<DayRow | null>(null)
  const [due, setDue] = useState(0)
  const [week, setWeek] = useState<DayRow[]>([])
  const [size, setSize] = useState<Awaited<ReturnType<typeof dailySize>> | null>(null)
  const [check, setCheck] = useState(false)
  const [retest, setRetest] = useState(false)
  const [upd, setUpd] = useState<UpdateInfo | null>(null)
  useEffect(() => { checkUpdate(true).then(setUpd).catch(() => {}) }, [])
  const [ep, setEp] = useState<ReturnType<typeof nextUp> | null>(null)
  const [prevTeaser, setPrevTeaser] = useState('')
  const [wk, setWk] = useState<Week | null>(null)
  const [cb, setCb] = useState<Comeback | null>(null)
  const [fresh, setFresh] = useState<Ability[]>([])
  const [mile, setMile] = useState<Milestone | null>(null)
  const [vdDue, setVdDue] = useState(false)
  const [vdOpen, setVdOpen] = useState(false)
  const [emma, setEmma] = useState<Nudge | null>(null)
  const [support, setSupport] = useState<{ s: SupportState; show: boolean } | null>(null)
  const [supportOpen, setSupportOpen] = useState(false)
  // 听学：在播的话显示讲到哪个词；没在播显示今天听了多久
  const [hear, setHear] = useState<{ st: PlayState; word: string } | null>(null)
  const [hearSec, setHearSec] = useState(0)
  useEffect(() => {
    let alive = true
    const look = async () => {
      const st = await player().state()
      const n = st.status !== 'idle' ? await recallNow() : null
      const word = n?.tracks[Math.min(st.index, n.tracks.length - 1)]?.word ?? st.word
      if (alive) setHear({ st, word })
    }
    look()
    // 原生服务在后台记的“听完的词”先收进来，再算今天听了多久
    syncHeard().catch(() => 0).then(() => todayHeard()).then((h) => { if (alive) setHearSec(h.sec) }).catch(() => {})
    const t = setInterval(look, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [tick])
  useEffect(() => {
    if (profile) {
      // 隔了一周以上回来：先摊开积压的复习（每天不比平时多），再显示“欢迎回来”
      dailySize(profile).then(async (sz) => {
        setSize(sz)
        const c = await comeback(sz.review)
        if (c && c.backlog > sz.review) await spreadBacklog(sz.review)
        setCb(c)
        dueCount().then(setDue)
      })
      weeklyDue(profile).then(setCheck)
      // 每月可选一次完整复测：离上次完整定级满 30 天
      db.one<{ ts: number }>("SELECT max(ts) ts FROM level_estimate WHERE source IN ('placement', 'manual')").then((r) => setRetest(Date.now() - (r?.ts ?? Date.now()) > 30 * 86400_000))
    }
    getAi().then(async (c) => {
      setEmma(await unreadNudge().catch(() => null))
      // 隔两天没聊：Emma 在后台先发一条（要接了 AI；失败就算了）
      if (c && profile && (await shouldNudge().catch(() => false))) {
        const [lv, ws] = await Promise.all([vocabLevel(profile), db.all<{ word: string }>('SELECT word FROM card WHERE known = 0 ORDER BY added DESC LIMIT 12')])
        nudge(c, lv.cefr, ws.map((w) => w.word)).then((n) => { if (n) { setEmma(n); import('../lib/reminder').then((m) => m.reschedule()).catch(() => {}) } }).catch(() => {})
      }
    })
    Promise.all([loadSeasons(), getProgress()]).then(([all, p]) => { const u = nextUp(all, p); setEp(u); setPrevTeaser(teaserFor(all, u.season.season, u.ep.id)) })
    dayRow().then(setD)
    dueCount().then(setDue)
    currentWeek().then(async (w) => { setWk(w); setWeek(await Promise.all(w.days.map((x) => dayRow(x.date)))) })
    Promise.all([getSupport(), stats()]).then(([s, st]) => setSupport({ s, show: shouldPrompt(s, st.days) }))
    if (profile) unseenAbilities(profile).then(setFresh).catch(() => {})
    // 在练习以外达成的里程碑（剧集、听写、聊天里跟读等）：回到今天页时庆祝
    if (profile) nextMilestone().then(setMile).catch(() => {})
    thisWeek().then((e) => setVdDue(!e)).catch(() => {})
  }, [tick, profile])
  if (!profile || !d || !size || !wk) return <div className="loading">…</div>
  const rv = { done: Math.min(d.reviews, size.review), want: Math.min(size.review, d.reviews + due) }
  const items = [
    { k: 'review', ico: <Icon.review />, t: '复习', s: rv.want ? '到期的词，趁快忘之前' : '今天没有到期的词', n: `${rv.done}/${rv.want}`, done: rv.want > 0 && rv.done >= rv.want },
    { k: 'new', ico: <Icon.plus />, t: '新词', s: '带例句和发音', n: `${Math.min(d.new_words, size.fresh)}/${size.fresh}`, done: d.new_words >= size.fresh },
    { k: 'listen', ico: <Icon.ear />, t: '听力', s: '听一句，选意思', n: `${Math.min(d.listens, size.listen)}/${size.listen}`, done: d.listens >= size.listen },
    { k: 'shadow', ico: <Icon.mic />, t: '跟读', s: '逐个音标打分', n: `${Math.min(d.shadows, size.shadow)}/${size.shadow}`, done: d.shadows >= size.shadow },
  ]
  const allDone = items.every((x) => x.done || (x.k === 'review' && rv.want === 0))
  const now = new Date()

  return (
    <div className="page fade-in">
      <div className="page-head">
        <h1>今天</h1>
        <span className="row"><span className="small muted">{now.getMonth() + 1} 月 {now.getDate()} 日 · 星期{WEEK[now.getDay()]}</span><button className="icon-btn ghost" aria-label="设置" onClick={onSettings}><Icon.settings /></button></span>
      </div>

      {mile && <Celebrate m={mile} onClose={() => setMile(null)} />}
      {upd && <UpdateCard info={upd} onClose={() => setUpd(null)} />}

      {/* 周目标：一周练 4 天算达标；不按天算连续，断一天不清零 */}
      <div className="streak-hero">
        <div className="streak-num"><b>{wk.lit}<small>/{wk.goal}</small></b><span>{wk.met ? (wk.streak > 1 ? `本周达标 · 连续 ${wk.streak} 周` : '本周达标') : `${wk.lit ? `再练 ${wk.goal - wk.lit} 天达标` : `一周练 ${wk.goal} 天就算达标`}${wk.streak ? ` · 已连续 ${wk.streak} 周` : ''}`}</span></div>
        <div className="week">
          {week.map((w) => {
            const dt = new Date(w.date + 'T12:00:00')
            const any = w.reviews + w.new_words + w.shadows + w.listens > 0
            const isToday = w.date === d.date
            return (
              <div key={w.date} className={w.date > d.date ? 'future' : undefined}>
                <div className="d">{WEEK[dt.getDay()]}</div>
                <div className={`dot ${w.done ? 'done' : any ? 'min' : ''} ${isToday ? 'today' : ''}`}>{w.done ? '✓' : dt.getDate()}</div>
              </div>
            )
          })}
        </div>
      </div>

      {cb && (
        <div className="card raised comeback">
          <b style={{ fontSize: 18 }}>欢迎回来</b>
          <p className="muted">离开了 {cb.away} 天，没关系。先用 3 分钟找回状态：复习几个词、听一句、跟读一句。</p>
          {cb.backlog > size.review && <p className="small muted">攒下的 {cb.backlog} 个到期词已经分到接下来 {cb.days} 天，每天不比平时多。</p>}
          <button className="btn primary block" onClick={() => onStart(true, true)}>开始 3 分钟</button>
        </div>
      )}

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
        {!allDone && <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => onStart(true)}>今天很累，只做 2 分钟</button>}
        <ModelPrefetchBar />
      </div>
      {(allDone || !!d.done) && <EggCard key={tick} />}

      <button className="card ai-card hear-entry" style={{ marginTop: 12 }} onClick={onListen}>
        <span className="ai-ico"><Icon.headphones /></span>
        <span className="t">
          <b>{hear && (hear.st.status === 'playing' || hear.st.status === 'paused' || hear.st.status === 'preparing') ? `${hear.st.status === 'paused' ? '暂停在' : '正在听'} · ${hear.word}` : '听学'}</b>
          <span>{hear && hear.st.status !== 'idle' && hear.st.total ? `第 ${hear.st.index + 1}/${hear.st.total} 个词，点开切词、定时关闭` : hearSec >= 60 ? `今天听了 ${Math.round(hearSec / 60)} 分钟。通勤、做家务时戴上耳机接着听` : '戴上耳机像听歌一样：老师读单词、拼写、讲意思和例句'}</span>
        </span>
      </button>

      {fresh.length > 0 && (
        <div className="card ability-new">
          <p className="small muted">{fresh.length > 1 ? `你现在能做到的 ${fresh.length} 件事` : '新做到的事'}</p>
          {fresh.slice(0, 3).map((a) => <b key={a.id}>{a.t}</b>)}
          <button className="btn small quiet" onClick={() => { markAbilitiesSeen(fresh.map((a) => a.id)); setFresh([]) }}>好</button>
        </div>
      )}

      {vdDue && d.reviews + d.new_words + d.shadows + d.listens > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row"><div><b>本周的声音日记</b><p className="small muted">读一遍同一段话，1 分钟。几周后和第一周对着听</p></div><div className="spacer" /><button className="btn small quiet" onClick={() => setVdOpen(true)}>录一段</button></div>
        </div>
      )}
      {vdOpen && <VoiceDiary onClose={() => { setVdOpen(false); thisWeek().then((e) => setVdDue(!e)) }} />}

      {emma && (
        <button className="card emma-nudge" onClick={() => onAi('chat')}>
          <span className="small muted">Emma 给你发了条消息</span>
          <b className="en">{emma.text}</b>
          {emma.zh && <span className="small muted">{emma.zh}</span>}
          <span className="small reply">回她 →</span>
        </button>
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

      {support?.show && (
        <div className="card support-nudge" style={{ marginTop: 12 }}>
          <div className="row"><div><b>喜欢日日说吗？</b><p className="small muted">一个人写的、没有广告。¥1 支持一下，这条就不再出现</p></div><div className="spacer" /><button className="btn small quiet" onClick={() => setSupportOpen(true)}>看看</button></div>
        </div>
      )}
      {supportOpen && support && <SupportSheet state={support.s} prompted onChange={(s) => setSupport({ s, show: shouldPrompt(s, Infinity) })} onClose={() => setSupportOpen(false)} />}

      {retest && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row"><div><b>满一个月了</b><p className="small muted">可以重新测一次词汇量，看看这个月的变化（约 3 分钟，可不做）</p></div><div className="spacer" /><button className="btn small quiet" onClick={onRetest}>去测</button></div>
        </div>
      )}

    </div>
  )
}

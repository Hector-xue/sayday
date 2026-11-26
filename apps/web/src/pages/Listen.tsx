// 听学：戴上耳机像听歌一样听，老师一个词一个词地讲（读、拼、讲意思、读例句）。
// 安卓上关掉这个页面、锁屏都接着播（原生前台服务），再打开这里能看到讲到哪了、切词、定时关闭
import { useEffect, useRef, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { Icon } from '../components/icons'
import { useApp } from '../store'
import { isNative } from '../lib/speech/engine'
import { COUNTS, SOURCES, buildPlaylist, estimateSec, getPrefs, heardCounts, savePrefs, todayHeard, type ListenPrefs } from '../lib/listen'
import { player, recallNow, rememberNow, syncHeard, type NowPlaying, type PlayState } from '../lib/listen-player'

const SLEEPS = [0, 15, 30, 60]
const fmtMin = (sec: number) => (sec < 60 ? `${Math.round(sec)} 秒` : `${Math.round(sec / 60)} 分钟`)

export function Listen({ onClose }: { onClose: () => void }) {
  const { profile, speed, toast } = useApp()
  const [prefs, setPrefs] = useState<ListenPrefs | null>(null)
  const [now, setNow] = useState<NowPlaying | null>(null)
  const [st, setSt] = useState<PlayState | null>(null)
  const [busy, setBusy] = useState(false)
  const [heard, setHeard] = useState({ sec: 0, words: 0 })
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [sleepPick, setSleepPick] = useState(0)
  const cur = useRef<HTMLButtonElement | null>(null)

  const refreshHeard = async (n: NowPlaying | null) => {
    await syncHeard().catch(() => 0)
    setHeard(await todayHeard().catch(() => ({ sec: 0, words: 0 })))
    if (n) setCounts(await heardCounts(n.tracks.map((t) => t.word)).catch(() => new Map()))
  }

  useEffect(() => {
    let alive = true
    getPrefs().then((p) => alive && setPrefs(p))
    recallNow().then((n) => { if (!alive) return; setNow(n); refreshHeard(n) })
    const poll = setInterval(() => { player().state().then((s) => alive && setSt(s)) }, 500)
    player().state().then((s) => alive && setSt(s))
    // 听完的词每 15 秒记一次（原生服务在后台记，这里取过来）
    const slow = setInterval(() => { recallNow().then(refreshHeard) }, 15_000)
    return () => { alive = false; clearInterval(poll); clearInterval(slow) }
  }, [])

  // 换词时把当前这个词滚到看得见的地方
  useEffect(() => { cur.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [st?.index])

  if (!profile || !prefs || !st) return <Overlay title="听学" onClose={onClose}><div className="loading">…</div></Overlay>

  const setP = (p: ListenPrefs) => { setPrefs(p); savePrefs(p) }
  // 按了按钮马上刷新一次（不等下一次轮询），按下去立刻看到换词 / 暂停
  const act = async (f: () => Promise<void>) => { await f(); setSt(await player().state()) }
  const active = st.status !== 'idle' && !!now?.tracks.length
  const track = active ? now!.tracks[Math.min(st.index, now!.tracks.length - 1)] : null
  const total = now?.tracks.reduce((s, t) => s + estimateSec(t), 0) ?? 0

  const start = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { tracks, src } = await buildPlaylist(prefs, profile)
      if (!tracks.length) {
        toast(src === 'preview' ? '没有可以预习的新词了' : '还没有学过的词：先在今日练习里学几个新词')
        return
      }
      if (src !== prefs.src) toast('今天还没有要学的词，先听最近学的')
      const n = { tracks, src, at: Date.now() }
      await player().start(tracks, { accent: profile.accent, rate: speed, loop: prefs.loop })
      await rememberNow(n)
      setNow(n)
      refreshHeard(n)
    } catch (e) {
      toast((e as Error)?.message || '没能开始播放')
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    await player().control('stop')
    await rememberNow(null)
    setNow(null)
    refreshHeard(null)
  }

  const head = heard.sec >= 30 ? `今天听了 ${fmtMin(heard.sec)} · ${heard.words} 个词` : undefined

  if (!active) {
    return (
      <Overlay title="听学" sub={head ?? '戴上耳机，像听歌一样学单词'} onClose={onClose}
        foot={<button className="btn primary block" disabled={busy} onClick={start}><Icon.headphones />{busy ? '准备中…' : '开始听'}</button>}>
        <div className="hear-body">
        <div className="hear-intro fade-in">
          <p>老师一个词一个词地讲：读单词、拼写、讲中文意思、读例句。{isNative ? '锁屏、切到别的 App 都接着播，耳机按键能暂停和切词。' : '页面开着就一直播，键盘的媒体键也能控制。'}</p>
        </div>
        <p className="section-title">听什么</p>
        <div className="list">
          {SOURCES.map((s) => (
            <button key={s.k} className="list-row hear-src" aria-pressed={prefs.src === s.k} onClick={() => setP({ ...prefs, src: s.k })}>
              <span className="main"><b>{s.name}</b><span>{s.desc}</span></span>
              <span className="side">{prefs.src === s.k ? <Icon.check /> : null}</span>
            </button>
          ))}
        </div>
        <p className="section-title">怎么讲</p>
        <div className="list">
          <div className="set-row">
            <div className="k"><b>一轮</b><span>听完{prefs.loop ? '从头再来' : '就停'}</span></div>
            <div className="seg">{COUNTS.map((n) => <button key={n} aria-pressed={prefs.n === n} onClick={() => setP({ ...prefs, n })}>{n} 词</button>)}</div>
          </div>
          <Toggle k="拼写" sub="一个字母一个字母地念" on={prefs.spell} set={(v) => setP({ ...prefs, spell: v })} />
          <Toggle k="中文讲解" sub="词的意思、例句的翻译" on={prefs.zh} set={(v) => setP({ ...prefs, zh: v })} />
          <Toggle k="例句" sub="每个词配一句" on={prefs.example} set={(v) => setP({ ...prefs, example: v })} />
          <Toggle k="循环" sub="一轮听完从头再听" on={prefs.loop} set={(v) => setP({ ...prefs, loop: v })} />
        </div>
        </div>
      </Overlay>
    )
  }

  const playing = st.status === 'playing'
  const preparing = st.status === 'preparing'
  const left = st.sleepAt ? Math.max(0, st.sleepAt - Date.now()) : 0
  const label = SOURCES.find((s) => s.k === now!.src)?.name ?? ''

  return (
    <Overlay title="听学" sub={`${label} · ${now!.tracks.length} 个词 · 一轮约 ${fmtMin(total)}`} onClose={onClose}
      right={<button className="btn small quiet" onClick={stop}>换一组</button>}>
      <div className="hear-body">
      {st.noZh && (
        <div className="card hear-note">
          <b>手机上没有中文语音，中文讲解先跳过了</b>
          <p className="small muted">{isNative ? '到系统设置里搜“文字转语音”，装一个中文语音引擎（如讯飞、Google 语音服务），再点“换一组”重新开始。' : '这个浏览器没有中文语音。换 Chrome / Edge，或者用安卓 App。'}</p>
        </div>
      )}
      {(st.status === 'error' || st.error) && <div className="card hear-note"><b>{st.status === 'error' ? '播放出错了' : '有一段没念出来，已经跳过'}</b><p className="small muted">{st.error || '点“换一组”重新开始试试'}</p></div>}

      {track && (
        <div className="hear-now fade-in" key={track.word}>
          <div className="hear-pos small muted">{st.index + 1} / {now!.tracks.length}{st.status === 'ended' ? ' · 听完了' : ''}</div>
          <div className="hear-word en">{track.word}</div>
          {track.ipa && <div className="muted">/{track.ipa}/</div>}
          {track.gloss && <div className="hear-gloss">{track.gloss}</div>}
          {track.sentence && (
            <div className="hear-ex">
              <div className="en">{track.sentence.en}</div>
              <div className="small muted">{track.sentence.zh}</div>
            </div>
          )}
        </div>
      )}

      <div className="hear-ctrl">
        <button className="icon-btn" aria-label="上一个" onClick={() => act(() => player().control('prev'))}><Icon.prev /></button>
        <button className="hear-play" aria-label={playing ? '暂停' : '播放'} disabled={preparing && !playing} onClick={() => act(() => player().control(playing ? 'pause' : 'play'))}>
          {playing ? <Icon.pause /> : <Icon.play />}
        </button>
        <button className="icon-btn" aria-label="下一个" onClick={() => act(() => player().control('next'))}><Icon.next /></button>
      </div>
      <p className="small muted hear-status">
        {preparing ? '正在准备音频…' : isNative && st.ready < st.total ? `已准备 ${st.ready}/${st.total} 个词，边听边准备` : isNative ? '音频都在手机上了，没信号也能听' : ''}
      </p>

      <div className="list" style={{ marginTop: 8 }}>
        <div className="set-row">
          <div className="k"><b>定时关闭</b><span>{left ? `${Math.ceil(left / 60000)} 分钟后停` : '不定时'}</span></div>
          <div className="seg">{SLEEPS.map((m) => <button key={m} aria-pressed={st.sleepAt ? sleepPick === m : m === 0} onClick={() => { setSleepPick(m); act(() => player().sleep(m)) }}>{m ? `${m}′` : '关'}</button>)}</div>
        </div>
      </div>

      <p className="section-title">这一轮{head ? ` · ${head}` : ''}</p>
      <div className="list">
        {now!.tracks.map((t, i) => (
          <button key={t.word} ref={i === st.index ? cur : undefined} className="list-row" aria-current={i === st.index ? 'true' : undefined} onClick={() => act(() => player().seek(i))}>
            <span className="main"><b>{t.word}</b><span>{t.gloss}</span></span>
            <span className="side">{counts.get(t.word) ? `听过 ${counts.get(t.word)} 遍` : ''}</span>
          </button>
        ))}
      </div>
      </div>
    </Overlay>
  )
}

function Toggle({ k, sub, on, set }: { k: string; sub: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="set-row">
      <div className="k"><b>{k}</b><span>{sub}</span></div>
      <div className="seg"><button aria-pressed={!on} onClick={() => set(false)}>关</button><button aria-pressed={on} onClick={() => set(true)}>开</button></div>
    </div>
  )
}

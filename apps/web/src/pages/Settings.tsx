import { useEffect, useState } from 'react'
import { SPEEDS, STYLES, useApp, type TextSize, type Theme } from '../store'
import { cachedAudioCount, clearAudioCache } from '../lib/tts'
import { Icon } from '../components/icons'
import { db } from '../lib/db'
import { goalLabel } from '../lib/levels'
import { isNative } from '../lib/speech/engine'
import { getAi, providerOf, type AiConfig } from '../lib/ai'
import { canRemind, enableReminder, getReminder, type Reminder } from '../lib/reminder'
import { openNotifySettings, pinWidget, systemStatus, type SystemStatus } from '../lib/system'
import { canUpdate, checkUpdate, currentVersion, type UpdateInfo } from '../lib/update'
import { UpdateCard } from '../components/UpdateCard'
import { MeEditor } from '../components/MeEditor'
import { DEFAULT_ME, getMe, type Me } from '../lib/episodes'
import { getSupport, type SupportState } from '../lib/support'
import { SupportSheet } from '../components/SupportSheet'
import { ModelPrefetchRow } from '../components/ModelPrefetch'
import { TOPICS, getInterests, setInterests } from '../lib/interests'
import { SyncRows } from '../components/SyncRow'
import { enableQuiz, getQuizCfg, testQuiz, type QuizCfg } from '../lib/quiz'

export function Settings({ onRedo, onAi, onBack }: { onRedo: (what: 'goal' | 'place') => void; onAi: () => void; onBack: () => void }) {
  const { profile, setProfile, theme, setTheme, style, setStyle, speed, setSpeed, textSize, setTextSize, toast } = useApp()
  const [storage, setStorage] = useState<string>('')
  const [ai, setAiCfg] = useState<AiConfig | null>(null)
  const { tick } = useApp()
  useEffect(() => { getAi().then(setAiCfg) }, [tick])
  const [rem, setRem] = useState<Reminder | null>(null)
  useEffect(() => { getReminder().then(setRem) }, [])
  const [sys, setSys] = useState<SystemStatus | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [quiz, setQuiz] = useState<QuizCfg | null>(null)
  useEffect(() => { getQuizCfg().then(setQuiz) }, [])
  const saveQuiz = async (q: QuizCfg) => { const e = await enableQuiz(q); if (e) { toast(e); return } setQuiz(q) }
  useEffect(() => { getInterests().then(setTags) }, [])
  // 从系统设置 / 桌面回来时刷新（通知开关、小组件个数）
  useEffect(() => {
    if (!canRemind) return
    const load = () => { if (document.visibilityState === 'visible') systemStatus().then(setSys) }
    load()
    document.addEventListener('visibilitychange', load)
    return () => document.removeEventListener('visibilitychange', load)
  }, [])
  const addWidget = async () => {
    if (sys?.canPin && (await pinWidget())) toast('在弹出的窗口里点“添加”')
    else toast('长按桌面空白处 → 小组件 → 找到“日日说”拖到桌面')
  }
  const [ver, setVer] = useState('')
  const [upd, setUpd] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [me, setMe] = useState<Me>(DEFAULT_ME)
  const [editMe, setEditMe] = useState(false)
  useEffect(() => { getMe().then(setMe) }, [tick])
  const [support, setSupport] = useState<SupportState>({})
  const [showSupport, setShowSupport] = useState(false)
  useEffect(() => { getSupport().then(setSupport) }, [tick])
  const [cache, setCache] = useState<{ clips: number; used: number } | null>(null)
  const loadCache = async () => {
    const clips = await cachedAudioCount()
    let used = 0
    try { used = (await navigator.storage?.estimate?.())?.usage ?? 0 } catch { /* 拿不到就不显示 */ }
    setCache({ clips, used })
  }
  useEffect(() => { loadCache() }, [])
  const clearCache = async () => {
    if (!confirm('清理已下载的示范音频？学习记录不受影响，之后播放时会重新下载。')) return
    await clearAudioCache()
    await loadCache()
    toast('已清理')
  }
  useEffect(() => { currentVersion().then(setVer).catch(() => {}) }, [])
  const check = async () => {
    setChecking(true)
    try {
      const u = await checkUpdate(false)
      setUpd(u)
      if (!u) toast('已经是最新版本')
    } catch (e) { toast((e as Error).message) }
    setChecking(false)
  }
  const saveRem = async (r: Reminder) => {
    const err = await enableReminder(r)
    if (err) { toast(err); return }
    setRem(r)
    toast(r.on ? `每天 ${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')} 提醒你；当天练过就不提醒` : '已关闭提醒')
  }
  useEffect(() => { db.info().then((i) => setStorage(i.mode === 'opfs' ? '本机存储（OPFS）' : i.mode === 'local' ? '浏览器存储（容量有限，建议用 App）' : '临时内存（关掉就没了，请换浏览器或用 App）')) }, [])
  if (!profile) return null

  const exportData = async () => {
    // 录音存档（recording、voice_diary）是二进制、体积大，不放进 JSON 备份
    const tables = ['kv', 'card', 'review_log', 'attempt', 'phoneme_stat', 'day', 'level_estimate', 'listen_log', 'chat', 'diary', 'speaking_test', 'writing', 'practice', 'work']
    const out: Record<string, unknown> = { app: 'sayday', exported: new Date().toISOString() }
    for (const t of tables) out[t] = await db.all(`SELECT * FROM ${t}`)
    const json = JSON.stringify(out)
    const name = `sayday-备份-${new Date().toISOString().slice(0, 10)}.json`
    const tauri = (globalThis as any).__TAURI__?.core
    if (tauri) {
      // App 里 WebView 不处理下载：交给原生插件写进系统“下载/Sayday”
      const u8 = new TextEncoder().encode(json)
      let bin = ''
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as unknown as number[])
      try { const r = await tauri.invoke('plugin:sayday-infer|save_to_downloads', { name, mime: 'application/json', data: btoa(bin) }); toast('已保存到 ' + r.path) } catch (e) { toast('导出失败：' + ((e as Error)?.message || e)) }
      return
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    a.download = name
    a.click()
    toast('已导出')
  }
  // 导入备份：换手机、卸载重装后恢复。只认本 App 导出的表，先清空再写入，一个事务里完成（失败不留半套）
  const importData = async (file: File) => {
    let data: Record<string, unknown>
    try { data = JSON.parse(await file.text()) } catch { toast('不是有效的备份文件'); return }
    if (data.app !== 'sayday') { toast('这不是日日说的备份文件'); return }
    const allowed = ['kv', 'card', 'review_log', 'attempt', 'phoneme_stat', 'day', 'level_estimate', 'listen_log', 'chat', 'diary', 'speaking_test', 'writing', 'practice', 'work']
    const tables = allowed.filter((t) => Array.isArray(data[t]))
    const n = tables.reduce((s, t) => s + (data[t] as unknown[]).length, 0)
    if (!confirm(`用备份（${String(data.exported).slice(0, 10)}，共 ${n} 条记录）覆盖现在的学习记录？`)) return
    const items: { sql: string; params?: unknown[] }[] = []
    for (const t of tables) {
      items.push({ sql: `DELETE FROM ${t}` })
      const cols = await db.all<{ name: string }>(`PRAGMA table_info(${t})`)
      const ok = new Set(cols.map((c) => c.name))
      for (const row of data[t] as Record<string, unknown>[]) {
        const ks = Object.keys(row).filter((k) => ok.has(k))
        if (ks.length) items.push({ sql: `INSERT INTO ${t}(${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`, params: ks.map((k) => row[k]) })
      }
    }
    try { await db.batch(items) } catch (e) { toast('导入失败：' + ((e as Error).message || e)); return }
    toast('已恢复，正在重新载入'); setTimeout(() => location.reload(), 800)
  }
  const reset = async () => {
    if (!confirm('清空所有学习记录？这一步不能撤销，建议先导出备份。')) return
    await db.batch(['card', 'review_log', 'attempt', 'phoneme_stat', 'day', 'level_estimate', 'listen_log', 'recording', 'voice_diary', 'chat', 'diary', 'speaking_test', 'writing', 'practice', 'work', 'kv', 'kv_ts'].map((t) => ({ sql: `DELETE FROM ${t}` })))
    location.reload()
  }

  return (
    <div className="page fade-in">
      <div className="page-head" style={{ justifyContent: 'flex-start', gap: 6 }}><button className="icon-btn ghost" aria-label="返回" onClick={onBack} style={{ marginLeft: -10 }}><Icon.back /></button><h1>设置</h1></div>
      <p className="section-title" style={{ marginTop: 0 }}>学习</p>
      <div className="list">
        <div className="set-row"><div className="k"><b>目标</b><span>{goalLabel(profile.goal)}（{profile.goal.target}）</span></div><button className="btn small quiet" onClick={() => onRedo('goal')}>修改</button></div>
        <div className="set-row">
          <div className="k"><b>每天</b><span>按这个时间排每天的量</span></div>
          <div className="seg">{[10, 20, 30, 45].map((m) => <button key={m} aria-pressed={profile.minutes === m} onClick={() => setProfile({ ...profile, minutes: m })}>{m}</button>)}</div>
        </div>
        <div className="set-row">
          <div className="k"><b>示范口音</b><span>听示范和例句用的声音</span></div>
          <div className="seg"><button aria-pressed={profile.accent === 'us'} onClick={() => setProfile({ ...profile, accent: 'us' })}>美音</button><button aria-pressed={profile.accent === 'gb'} onClick={() => setProfile({ ...profile, accent: 'gb' })}>英音</button></div>
        </div>
        <div className="set-row"><div className="k"><b>剧里的你</b><span>叫 {me.name === 'Lin' ? 'Lin（林）' : me.name} · {me.voice === 'm' ? '男声' : '女声'}</span></div><button className="btn small quiet" onClick={() => setEditMe(true)}>修改</button></div>
        <div className="set-row">
          <div className="k"><b>示范语速</b><span>{speed < 1 ? '放慢一点，听清每个音' : speed > 1 ? '快一点，接近真实语速' : '正常语速'}</span></div>
          <div className="seg">{SPEEDS.map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s === 1 ? '1×' : `${s}×`}</button>)}</div>
        </div>
        <div className="set-row interests">
          <div className="k"><b>兴趣</b><span>{tags.length ? '每日听力和跟读的例句多从这些话题里挑' : '选几个，例句多挑你感兴趣的话题；不选就随机'}</span></div>
          <div className="chips">{TOPICS.map((t) => <button key={t.id} className="chip" aria-pressed={tags.includes(t.id)} onClick={async () => { const n = tags.includes(t.id) ? tags.filter((x) => x !== t.id) : [...tags, t.id]; setTags(n); await setInterests(n) }}>{t.zh}</button>)}</div>
        </div>
        <div className="set-row"><div className="k"><b>重新定级</b><span>当前起点 {profile.placement.cefr} · 约 {profile.placement.vocab.toLocaleString()} 词</span></div><button className="btn small quiet" onClick={() => onRedo('place')}>重测</button></div>
      </div>

      <p className="section-title">AI</p>
      <div className="list">
        <div className="set-row"><div className="k"><b>你自己的 AI</b><span>{ai ? `${providerOf(ai.provider).name} · ${ai.model}` : '陪练聊天、日记批改要用。DeepSeek、通义、Kimi 等都行'}</span></div><button className="btn small quiet" onClick={onAi}>{ai ? '修改' : '接入'}</button></div>
      </div>

      <p className="section-title">提醒与小组件</p>
      <div className="list">
        {canRemind ? (<>
        {rem && (
          <div className="set-row">
            <div className="k"><b>每日提醒</b><span>{rem.on ? '当天练过就不打扰' : '到点提醒你练一会儿'}</span></div>
            {rem.on && <input className="input time" type="time" value={`${String(rem.hour).padStart(2, '0')}:${String(rem.minute).padStart(2, '0')}`} onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); if (!Number.isNaN(h)) saveRem({ on: true, hour: h, minute: m || 0 }) }} />}
            <div className="seg"><button aria-pressed={!rem.on} onClick={() => saveRem({ ...rem, on: false })}>关</button><button aria-pressed={rem.on} onClick={() => saveRem({ ...rem, on: true })}>开</button></div>
          </div>
        )}
        {quiz && (
          <div className="set-row">
            <div className="k"><b>通知里做题</b><span>{quiz.on ? '每天到点弹 3 道复习题，在通知里直接答，答了就算今天练过' : '不打开 App 也能复习：在通知里点按钮、写拼写'}</span></div>
            {quiz.on && <input className="input time" type="time" value={`${String(quiz.hour).padStart(2, '0')}:${String(quiz.minute).padStart(2, '0')}`} onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); if (!Number.isNaN(h)) saveQuiz({ on: true, hour: h, minute: m || 0 }) }} />}
            <div className="seg"><button aria-pressed={!quiz.on} onClick={() => saveQuiz({ ...quiz, on: false })}>关</button><button aria-pressed={quiz.on} onClick={() => saveQuiz({ ...quiz, on: true })}>开</button></div>
          </div>
        )}
        {quiz?.on && (
          <div className="set-row">
            <div className="k"><b>现在试一题</b><span>马上弹一轮，看看通知里怎么答</span></div>
            <button className="btn small quiet" onClick={async () => { const e = await testQuiz(); toast(e ?? '已经发到通知栏了，下拉看看') }}>试一下</button>
          </div>
        )}
          <div className="set-row">
            <div className="k"><b>系统通知</b><span>{sys ? (sys.notify ? '已允许' : '已关闭 · 提醒不会弹出来') : '提醒铃声、横幅样式在系统里改'}</span></div>
            <button className="btn small quiet" onClick={async () => { if (!(await openNotifySettings())) toast('到系统设置 → 应用 → 日日说 → 通知 里改') }}>{sys && !sys.notify ? '去打开' : '系统设置'}</button>
          </div>
          <div className="set-row">
            <div className="k"><b>桌面小组件</b><span>{sys?.widgets ? `桌面上已有 ${sys.widgets} 个 · ` : ''}本周练了几天、今天练没练、一个在学的词</span></div>
            <button className="btn small quiet" onClick={addWidget}>{sys?.widgets ? '再加一个' : '添加'}</button>
          </div>
        </>) : (
          <div className="set-row">
            <div className="k"><b>每日提醒 · 桌面小组件</b><span>网页版做不了，安卓 App 里有</span></div>
            <a className="btn small quiet" href="https://sayday.ivyea.com/#download" target="_blank" rel="noreferrer">下载 App</a>
          </div>
        )}
      </div>

      <p className="section-title">外观</p>
      <div className="style-pick">
        {STYLES.map((x) => (
          <button key={x.k} className="style-opt" data-preview={x.k} aria-pressed={style === x.k} onClick={() => setStyle(x.k)}>
            <span className="style-swatch" aria-hidden><i /><i /><i /></span>
            <b>{x.name}</b><span>{x.desc}</span>
          </button>
        ))}
      </div>
      <div className="list" style={{ marginTop: 12 }}>
        <div className="set-row">
          <div className="k"><b>深浅</b></div>
          <div className="seg">{([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as [Theme, string][]).map(([k, t]) => <button key={k} aria-pressed={theme === k} onClick={() => setTheme(k)}>{t}</button>)}</div>
        </div>
        <div className="set-row">
          <div className="k"><b>字号</b></div>
          <div className="seg">{([['md', '标准'], ['lg', '大'], ['xl', '特大']] as [TextSize, string][]).map(([k, t]) => <button key={k} aria-pressed={textSize === k} onClick={() => setTextSize(k)}>{t}</button>)}</div>
        </div>
      </div>

      <p className="section-title">数据</p>
      <div className="list">
        <SyncRows />
        <div className="set-row"><div className="k"><b>保存在</b><span>{storage}{isNative ? ' · App' : ''}</span></div></div>
        <ModelPrefetchRow />
        {cache && (
          <div className="set-row"><div className="k"><b>离线缓存</b><span>已下载示范音频 {cache.clips.toLocaleString()} 条{cache.used ? ` · 本机共占 ${Math.round(cache.used / 1048576)} MB（含学习记录和语音模型）` : ''}</span></div><button className="btn small quiet" disabled={!cache.clips} onClick={clearCache}>清理</button></div>
        )}
        <div className="set-row"><div className="k"><b>导出备份</b><span>全部学习记录，JSON 文件</span></div><button className="btn small quiet" onClick={exportData}>导出</button></div>
        <div className="set-row"><div className="k"><b>导入备份</b><span>换手机、重装后用导出的文件恢复</span></div><label className="btn small quiet" style={{ display: 'inline-grid', placeItems: 'center' }}>选择文件<input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importData(f) }} /></label></div>
        <div className="set-row"><div className="k"><b>清空记录</b><span>从头开始</span></div><button className="btn small quiet" style={{ color: 'var(--bad)' }} onClick={reset}>清空</button></div>
      </div>

      <p className="section-title">关于</p>
      {canUpdate && (
        <div className="list" style={{ marginBottom: 12 }}>
          <div className="set-row"><div className="k"><b>版本</b><span>{ver ? `v${ver}` : '…'}</span></div><button className="btn small quiet" disabled={checking} onClick={check}>{checking ? '检查中…' : '检查更新'}</button></div>
        </div>
      )}
      {upd && <div style={{ marginBottom: 12 }}><UpdateCard info={upd} /></div>}
      <div className="list" style={{ marginBottom: 12 }}>
        <div className="set-row"><div className="k"><b>支持日日说</b><span>{support.since ? '已支持 · 谢谢' : '¥1 · 不付也一样用'}</span></div><button className="btn small quiet" onClick={() => setShowSupport(true)}>{support.since ? '看看' : '支持'}</button></div>
        <div className="set-row"><div className="k"><b>隐私</b><span>学习记录和录音只存在这台设备上</span></div><button className="btn small quiet" onClick={() => setPrivacy((x) => !x)}>{privacy ? '收起' : '详情'}</button></div>
        {privacy && (
          <div className="privacy">
            <p>不需要注册，没有账号，也不收集任何统计数据。</p>
            <p>录音只在本机打分，不上传；学习记录存在本机，换手机请用“导出备份”。</p>
            <p>会联网的只有这几件事：</p>
            <ul>
              <li>下载示范音频、语音识别模型（只下载，不上传任何东西）</li>
              <li>检查新版本（只读取版本号）</li>
              <li>你自己接入 AI 后，陪练聊天、日记和写作批改、口语模考评分会把文字发给你选的 AI 服务商（口语发的是本机转写出的文字，不是录音）</li>
            </ul>
          </div>
        )}
      </div>
      <div className="card">
        <p className="small muted">日日说 · MIT 开源 · 所有练习数据只在你的设备上，录音不上传。</p>
        <p className="small muted" style={{ marginTop: 8 }}>词典 ECDICT（MIT）· 例句 Tatoeba（CC BY 2.0 FR）· 发音词典 CMUdict（BSD）· 评测数据 speechocean762（CC BY 4.0）· 示范语音 Kokoro（Apache-2.0，预先生成）· 音素识别 Charsiu（Zhu 等，2022）· 语音识别 Moonshine（MIT）· 字体 Bricolage Grotesque、Newsreader、Noto Serif SC（OFL）</p>
        <p className="small" style={{ marginTop: 8 }}><a href="https://github.com/Hector-xue/sayday" style={{ color: 'var(--brand)' }}>源码与完整致谢</a></p>
      </div>
      {editMe && <MeEditor me={me} onClose={() => setEditMe(false)} />}
      {showSupport && <SupportSheet state={support} onChange={setSupport} onClose={() => setShowSupport(false)} />}
    </div>
  )
}

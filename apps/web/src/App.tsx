import { useState, type CSSProperties, type ReactElement } from 'react'
import { AppProvider, useApp } from './store'
import { Icon } from './components/icons'
import { Onboarding } from './pages/Onboarding'
import { Today } from './pages/Today'
import { Session } from './pages/Session'
import { Words } from './pages/Words'
import { Progress } from './pages/Progress'
import { Settings } from './pages/Settings'
import { Lab } from './pages/Lab'
import { AiSetup } from './pages/AiSetup'
import { Chat } from './pages/Chat'
import { Diary } from './pages/Diary'
import { Episodes } from './pages/Episodes'
import { Writing } from './pages/Writing'
import { Practice } from './pages/Practice'
import { Speaking } from './pages/Speaking'

type Tab = 'today' | 'episodes' | 'lab' | 'words' | 'progress' | 'settings'
// 设置不占底栏：从“今天”和“进步”右上角的齿轮进
const TABS: { k: Tab; t: string; i: () => ReactElement }[] = [
  { k: 'today', t: '今天', i: Icon.today }, { k: 'episodes', t: '剧集', i: Icon.film }, { k: 'lab', t: '发音', i: Icon.mic }, { k: 'words', t: '词库', i: Icon.words }, { k: 'progress', t: '进步', i: Icon.progress },
]

function Main() {
  const { profile } = useApp()
  const [tab, setTab] = useState<Tab>('today')
  // 底栏选中块每滑一次 +1：给小胶囊换 key，重放“路上拉长、到了回弹”的动画（首次进来不放）
  const [moves, setMoves] = useState(0)
  // 进设置页时选中块原地淡出，回来再从原处出现（不从屏幕外滑进来）
  const [pill, setPill] = useState(0)
  const go = (t: Tab) => {
    if (t === tab) return
    const i = TABS.findIndex((x) => x.k === t)
    if (i >= 0 && i !== pill) { setPill(i); setMoves((n) => n + 1) }
    setTab(t)
  }
  const [session, setSession] = useState<null | { minimum: boolean; comeback?: boolean }>(null)
  const [redo, setRedo] = useState<null | 'goal' | 'place'>(null)
  const [ai, setAi] = useState<null | 'setup' | 'chat' | 'diary' | 'writing'>(null)
  const [openEp, setOpenEp] = useState<{ season: number; ep: number } | null>(null)
  const [after, setAfter] = useState<null | 'chat' | 'diary' | 'writing'>(null)
  const [ielts, setIelts] = useState<null | 'reading' | 'listening' | 'speaking'>(null)
  const { refresh } = useApp()
  if (profile === undefined) return <div className="loading">…</div>
  if (!profile || redo) return <Onboarding redo={redo ?? undefined} key={redo ?? 'new'} onExit={() => setRedo(null)} />
  return (
    <div className="shell">
      {tab === 'today' && <Today onStart={(minimum, comeback) => setSession({ minimum, comeback })} onRetest={() => setRedo('place')} onAi={setAi} onEpisode={(id) => { setOpenEp(id); go('episodes') }} onSettings={() => go('settings')} onIelts={setIelts} />}
      {tab === 'episodes' && <Episodes openId={openEp} onOpened={() => setOpenEp(null)} />}
      {tab === 'lab' && <Lab onSetupAi={() => setAi('setup')} />}
      {tab === 'words' && <Words />}
      {tab === 'progress' && <Progress onSettings={() => go('settings')} />}
      {tab === 'settings' && <Settings onRedo={setRedo} onAi={() => setAi('setup')} onBack={() => go('today')} />}
      <div className="tabbar">
        <nav style={{ '--i': pill } as CSSProperties}>
          {/* 选中块：一块会滑的小胶囊，四周和底栏留一样宽的缝、两头同心（设置页不在底栏里，就藏起来） */}
          <span className="tab-pill" aria-hidden="true" data-off={TABS.some((x) => x.k === tab) ? undefined : ''}><i key={moves} className={moves ? 'go' : undefined} /></span>
          {TABS.map((x) => (
            <button key={x.k} className="tab" aria-current={tab === x.k ? 'page' : undefined} onClick={() => go(x.k)}><x.i />{x.t}</button>
          ))}
        </nav>
      </div>
      {session && <Session minimum={session.minimum} comeback={session.comeback} onClose={() => setSession(null)} />}
      {ai === 'chat' && <Chat onClose={() => { setAi(null); refresh() }} onSetup={() => { setAfter('chat'); setAi('setup') }} />}
      {ai === 'diary' && <Diary onClose={() => { setAi(null); refresh() }} onSetup={() => { setAfter('diary'); setAi('setup') }} />}
      {ai === 'writing' && <Writing onClose={() => { setAi(null); refresh() }} onSetup={() => { setAfter('writing'); setAi('setup') }} />}
      {(ielts === 'reading' || ielts === 'listening') && <Practice kind={ielts} onClose={() => { setIelts(null); refresh() }} />}
      {ielts === 'speaking' && <Speaking onClose={() => { setIelts(null); refresh() }} onSetupAi={() => { setIelts(null); setAi('setup') }} />}
      {ai === 'setup' && <AiSetup onClose={(ok) => { setAi(ok ? after : null); setAfter(null); refresh() }} />}
    </div>
  )
}

export function App() {
  return <AppProvider><Main /></AppProvider>
}

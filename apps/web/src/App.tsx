import { useState, type ReactElement } from 'react'
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

type Tab = 'today' | 'episodes' | 'lab' | 'words' | 'progress' | 'settings'
// 设置不占底栏：从“今天”和“进步”右上角的齿轮进
const TABS: { k: Tab; t: string; i: () => ReactElement }[] = [
  { k: 'today', t: '今天', i: Icon.today }, { k: 'episodes', t: '剧集', i: Icon.film }, { k: 'lab', t: '发音', i: Icon.mic }, { k: 'words', t: '词库', i: Icon.words }, { k: 'progress', t: '进步', i: Icon.progress },
]

function Main() {
  const { profile } = useApp()
  const [tab, setTab] = useState<Tab>('today')
  const [session, setSession] = useState<null | { minimum: boolean }>(null)
  const [redo, setRedo] = useState<null | 'goal' | 'place'>(null)
  const [ai, setAi] = useState<null | 'setup' | 'chat' | 'diary' | 'writing'>(null)
  const [openEp, setOpenEp] = useState<number | null>(null)
  const [after, setAfter] = useState<null | 'chat' | 'diary' | 'writing'>(null)
  const { refresh } = useApp()
  if (profile === undefined) return <div className="loading">…</div>
  if (!profile || redo) return <Onboarding redo={redo ?? undefined} key={redo ?? 'new'} onExit={() => setRedo(null)} />
  return (
    <div className="shell">
      {tab === 'today' && <Today onStart={(minimum) => setSession({ minimum })} onRetest={() => setRedo('place')} onAi={setAi} onEpisode={(id) => { setOpenEp(id); setTab('episodes') }} onSettings={() => setTab('settings')} />}
      {tab === 'episodes' && <Episodes openId={openEp} onOpened={() => setOpenEp(null)} />}
      {tab === 'lab' && <Lab onSetupAi={() => setAi('setup')} />}
      {tab === 'words' && <Words />}
      {tab === 'progress' && <Progress onSettings={() => setTab('settings')} />}
      {tab === 'settings' && <Settings onRedo={setRedo} onAi={() => setAi('setup')} onBack={() => setTab('today')} />}
      <div className="tabbar">
        <nav>
          {TABS.map((x) => (
            <button key={x.k} className="tab" aria-current={tab === x.k ? 'page' : undefined} onClick={() => setTab(x.k)}><x.i />{x.t}</button>
          ))}
        </nav>
      </div>
      {session && <Session minimum={session.minimum} onClose={() => setSession(null)} />}
      {ai === 'chat' && <Chat onClose={() => { setAi(null); refresh() }} onSetup={() => { setAfter('chat'); setAi('setup') }} />}
      {ai === 'diary' && <Diary onClose={() => { setAi(null); refresh() }} onSetup={() => { setAfter('diary'); setAi('setup') }} />}
      {ai === 'writing' && <Writing onClose={() => { setAi(null); refresh() }} onSetup={() => { setAfter('writing'); setAi('setup') }} />}
      {ai === 'setup' && <AiSetup onClose={(ok) => { setAi(ok ? after : null); setAfter(null); refresh() }} />}
    </div>
  )
}

export function App() {
  return <AppProvider><Main /></AppProvider>
}

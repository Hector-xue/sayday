import { useState, type ReactElement } from 'react'
import { AppProvider, useApp } from './store'
import { Icon } from './components/icons'
import { Onboarding } from './pages/Onboarding'
import { Today } from './pages/Today'
import { Session } from './pages/Session'
import { Words } from './pages/Words'
import { Progress } from './pages/Progress'
import { Settings } from './pages/Settings'

type Tab = 'today' | 'words' | 'progress' | 'settings'
const TABS: { k: Tab; t: string; i: () => ReactElement }[] = [
  { k: 'today', t: '今天', i: Icon.today }, { k: 'words', t: '词库', i: Icon.words }, { k: 'progress', t: '进步', i: Icon.progress }, { k: 'settings', t: '设置', i: Icon.settings },
]

function Main() {
  const { profile } = useApp()
  const [tab, setTab] = useState<Tab>('today')
  const [session, setSession] = useState<null | { minimum: boolean }>(null)
  const [redo, setRedo] = useState<null | 'goal' | 'place'>(null)
  if (profile === undefined) return <div className="loading">…</div>
  if (!profile || redo) return <Onboarding redo={redo ?? undefined} key={redo ?? 'new'} />
  return (
    <div className="shell">
      {tab === 'today' && <Today onStart={(minimum) => setSession({ minimum })} />}
      {tab === 'words' && <Words />}
      {tab === 'progress' && <Progress />}
      {tab === 'settings' && <Settings onRedo={setRedo} />}
      <div className="tabbar">
        <nav>
          {TABS.map((x) => (
            <button key={x.k} className="tab" aria-current={tab === x.k ? 'page' : undefined} onClick={() => setTab(x.k)}><x.i />{x.t}</button>
          ))}
        </nav>
      </div>
      {session && <Session minimum={session.minimum} onClose={() => setSession(null)} />}
    </div>
  )
}

export function App() {
  return <AppProvider><Main /></AppProvider>
}

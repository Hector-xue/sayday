// 全局状态：档案、刷新信号、轻提示、主题
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getProfile, saveProfile, type Profile } from './lib/lesson'
import { kvGet, kvSet } from './lib/db'

export type Theme = 'system' | 'light' | 'dark'
type Ctx = {
  profile: Profile | null | undefined
  setProfile: (p: Profile) => Promise<void>
  tick: number
  refresh: () => void
  toast: (msg: string) => void
  theme: Theme
  setTheme: (t: Theme) => void
}
const C = createContext<Ctx>(null as unknown as Ctx)
export const useApp = () => useContext(C)

const applyTheme = (t: Theme) => {
  if (t === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setP] = useState<Profile | null | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const [theme, setT] = useState<Theme>('system')
  useEffect(() => {
    getProfile().then(setP).catch(() => setP(null))
    kvGet<Theme>('theme', 'system').then((t) => { setT(t); applyTheme(t) })
  }, [])
  const setProfile = useCallback(async (p: Profile) => { await saveProfile(p); setP(p) }, [])
  const toast = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg((x) => (x === m ? null : x)), 2600) }, [])
  const setTheme = useCallback((t: Theme) => { setT(t); applyTheme(t); kvSet('theme', t) }, [])
  return (
    <C.Provider value={{ profile, setProfile, tick, refresh: () => setTick((x) => x + 1), toast, theme, setTheme }}>
      {children}
      {msg && <div className="toast fade-in" role="status">{msg}</div>}
    </C.Provider>
  )
}

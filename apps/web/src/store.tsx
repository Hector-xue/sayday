// 全局状态：档案、刷新信号、轻提示、主题（深浅）与风格
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getProfile, saveProfile, type Profile } from './lib/lesson'
import { kvGet, kvSet } from './lib/db'

export type Theme = 'system' | 'light' | 'dark'
// 风格：marker 荧光笔（默认）/ classic 经典。index.html 启动时先从 localStorage 读，避免先闪一下旧样式
export type Style = 'marker' | 'classic'
export const STYLES: { k: Style; name: string; desc: string }[] = [
  { k: 'marker', name: '荧光笔', desc: '白纸黑字，重点用荧光黄划出来' },
  { k: 'classic', name: '经典', desc: '蓝色，最早的样子' },
]
type Ctx = {
  profile: Profile | null | undefined
  setProfile: (p: Profile) => Promise<void>
  tick: number
  refresh: () => void
  toast: (msg: string) => void
  theme: Theme
  setTheme: (t: Theme) => void
  style: Style
  setStyle: (s: Style) => void
}
const C = createContext<Ctx>(null as unknown as Ctx)
export const useApp = () => useContext(C)

const remember = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* 隐私模式等：只是启动时会闪一下 */ } }
const applyTheme = (t: Theme) => {
  if (t === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
  remember('sayday-theme', t)
  syncChrome()
}
// 状态栏颜色跟着当前底色走；启动脚本临时加在 <html> 上的底色也在这里撤掉
const syncChrome = () => requestAnimationFrame(() => {
  document.documentElement.style.removeProperty('background')
  const bg = getComputedStyle(document.body).backgroundColor
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg))
})
const applyStyle = (s: Style) => {
  document.documentElement.setAttribute('data-style', s)
  remember('sayday-style', s)
  syncChrome()
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setP] = useState<Profile | null | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const [theme, setT] = useState<Theme>('system')
  const [style, setS] = useState<Style>(() => (document.documentElement.getAttribute('data-style') as Style) || 'marker')
  useEffect(() => {
    getProfile().then(setP).catch(() => setP(null))
    // 每次打开 App 重排每日提醒（文案跟着进度更新）
    import('./lib/reminder').then((m) => m.reschedule()).catch(() => {})
    kvGet<Theme>('theme', 'system').then((t) => { setT(t); applyTheme(t) })
    kvGet<Style>('style', 'marker').then((x) => { const v = STYLES.some((y) => y.k === x) ? x : 'marker'; setS(v); applyStyle(v) })
  }, [])
  const setProfile = useCallback(async (p: Profile) => { await saveProfile(p); setP(p) }, [])
  const toast = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg((x) => (x === m ? null : x)), 2600) }, [])
  const setTheme = useCallback((t: Theme) => { setT(t); applyTheme(t); kvSet('theme', t) }, [])
  const setStyle = useCallback((x: Style) => { setS(x); applyStyle(x); kvSet('style', x) }, [])
  return (
    <C.Provider value={{ profile, setProfile, tick, refresh: () => setTick((x) => x + 1), toast, theme, setTheme, style, setStyle }}>
      {children}
      {msg && <div className="toast fade-in" role="status">{msg}</div>}
    </C.Provider>
  )
}

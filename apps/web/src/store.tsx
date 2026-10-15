// 全局状态：档案、刷新信号、轻提示、主题（深浅）与风格
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getProfile, saveProfile, type Profile } from './lib/lesson'
import { kvGet, kvSet } from './lib/db'
import { setSpeed as setTtsSpeed } from './lib/tts'
import { syncBars } from './lib/native-chrome'

export type Theme = 'system' | 'light' | 'dark'
// 字号：整页内容一起放大（底栏不变）。启动脚本先从 localStorage 读，避免先闪一下小字
export type TextSize = 'md' | 'lg' | 'xl'
export const SPEEDS = [0.8, 0.9, 1, 1.1] as const
// 风格：marker 荧光笔（默认）/ paper 纸与墨 / classic 经典。index.html 启动时先从 localStorage 读，避免先闪一下旧样式
export type Style = 'marker' | 'paper' | 'classic'
export const STYLES: { k: Style; name: string; desc: string }[] = [
  { k: 'marker', name: '荧光笔', desc: '白纸黑字，重点用荧光黄划出来' },
  { k: 'paper', name: '纸与墨', desc: '暖纸色、宋体标题，像一本读本' },
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
  speed: number
  setSpeed: (s: number) => void
  textSize: TextSize
  setTextSize: (s: TextSize) => void
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
  syncBars(bg)
})
// 跟随系统深浅时，系统切换了也要同步状态栏颜色
if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => syncChrome())
const applyTextSize = (s: TextSize) => {
  if (s === 'md') document.documentElement.removeAttribute('data-text')
  else document.documentElement.setAttribute('data-text', s)
  remember('sayday-text', s)
}
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
  const [speed, setSp] = useState(1)
  const [textSize, setTs] = useState<TextSize>(() => (document.documentElement.getAttribute('data-text') as TextSize) || 'md')
  useEffect(() => {
    getProfile().then(setP).catch(() => setP(null))
    // 每次打开 App 重排每日提醒（文案跟着进度更新）
    import('./lib/reminder').then((m) => m.reschedule()).catch(() => {})
    // 多设备同步：打开 App 拉一次别的设备的记录；有变化就重读档案、刷新页面数据
    import('./lib/sync').then((m) => m.autoSync()).then((changed) => { if (changed) { getProfile().then(setP).catch(() => {}); setTick((x) => x + 1) } }).catch(() => {})
    // 切到后台时也传一次（两分钟内传过就跳过）
    const onHide = () => { if (document.visibilityState === 'hidden') import('./lib/sync').then((m) => m.autoSync()).catch(() => {}) }
    document.addEventListener('visibilitychange', onHide)
    kvGet<Theme>('theme', 'system').then((t) => { setT(t); applyTheme(t) })
    // 数据库里还没存过：沿用启动脚本从本机缓存读到的（默认荧光笔）
    const boot = (document.documentElement.getAttribute('data-style') as Style) || 'marker'
    kvGet<number>('speed', 1).then((x) => { const v = SPEEDS.includes(x as never) ? x : 1; setSp(v); setTtsSpeed(v) })
    kvGet<TextSize>('text_size', (document.documentElement.getAttribute('data-text') as TextSize) || 'md').then((x) => { const v = ['md', 'lg', 'xl'].includes(x) ? x : 'md'; setTs(v); applyTextSize(v) })
    kvGet<Style>('style', boot).then((x) => { const v = STYLES.some((y) => y.k === x) ? x : 'marker'; setS(v); applyStyle(v) })
  }, [])
  const setProfile = useCallback(async (p: Profile) => { await saveProfile(p); setP(p) }, [])
  const toast = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg((x) => (x === m ? null : x)), 2600) }, [])
  const setTheme = useCallback((t: Theme) => { setT(t); applyTheme(t); kvSet('theme', t) }, [])
  const setStyle = useCallback((x: Style) => { setS(x); applyStyle(x); kvSet('style', x) }, [])
  const setSpeed = useCallback((x: number) => { setSp(x); setTtsSpeed(x); kvSet('speed', x) }, [])
  const setTextSize = useCallback((x: TextSize) => { setTs(x); applyTextSize(x); kvSet('text_size', x) }, [])
  return (
    <C.Provider value={{ profile, setProfile, tick, refresh: () => setTick((x) => x + 1), toast, theme, setTheme, style, setStyle, speed, setSpeed, textSize, setTextSize }}>
      {children}
      {msg && <div className="toast fade-in" role="status">{msg}</div>}
    </C.Provider>
  )
}

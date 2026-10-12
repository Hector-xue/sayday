// 安卓 App 的系统栏：WebView 报给网页的 safe-area-inset 是 0（App 铺满全屏，内容会顶到状态栏、底栏压在手势条上），
// 所以向原生插件要真实高度，写成 CSS 变量 --sat-n / --sab-n（app.css 里和 env(safe-area-inset-*) 取大）。
// 状态栏图标颜色也跟着页面深浅切换。网页版什么都不做。
const tauri = (globalThis as any).__TAURI__?.core as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined

async function applyInsets() {
  if (!tauri) return
  try {
    const r = await tauri.invoke('plugin:sayday-infer|insets')
    if (typeof r?.top !== 'number') return
    const s = document.documentElement.style
    s.setProperty('--sat-n', `${Math.round(r.top)}px`)
    s.setProperty('--sab-n', `${Math.round(r.bottom)}px`)
  } catch { /* 老版本插件没有这个命令：保持 0 */ }
}

export function initNativeChrome() {
  if (!tauri) return
  applyInsets()
  // 刚启动时窗口可能还没拿到系统栏尺寸，稍后再问一次；转屏、分屏时尺寸会变
  setTimeout(applyInsets, 500)
  addEventListener('resize', () => applyInsets())
  document.addEventListener('visibilitychange', () => { if (!document.hidden) applyInsets() })
}

/** bg：页面当前底色（getComputedStyle 的 rgb(...)）。深色底就让系统栏图标变浅 */
export function syncBars(bg: string) {
  if (!tauri) return
  const m = bg.match(/\d+(\.\d+)?/g)
  if (!m) return
  const [r, g, b] = m.map(Number)
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
  tauri.invoke('plugin:sayday-infer|set_bars', { dark }).catch(() => {})
}

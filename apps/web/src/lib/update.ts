// 应用内更新（只在安卓 App 里）：读本站 download/version.json（scripts/sync-release.sh 从 GitHub Release 同步），
// 比装着的版本新就提示；下载、核对 SHA-256、调起系统安装器都在原生插件里做（Updater.kt），这里只管流程和轮询进度。
// 覆盖安装，学习记录都在。
const tauri = (globalThis as any).__TAURI__?.core as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined

export const canUpdate = !!tauri
const VERSION_URL = 'https://sayday.ivyea.com/download/version.json'
const CHECKED = 'sayday-update-checked'
const SKIP = 'sayday-update-skip'
// 自动检查的间隔：一天最多几次，不每次切回 App 都去问
const EVERY = 6 * 3600_000

export type UpdateInfo = {
  version: string
  current: string
  title: string
  points: string[]
  urls: string[]
  sha256: string
  size: number
}

export type UpdateState = { state: 'idle' | 'running' | 'done' | 'error'; done: number; total: number; error: string; current: string }

const call = (cmd: string, args?: object) => tauri!.invoke(`plugin:sayday-infer|${cmd}`, args)

/** a 比 b 新返回正数（只比 x.y.z 的数字部分） */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

/** 发版说明（markdown）→ 标题 + 要点；“覆盖安装”那句每版都有，不重复显示 */
export function parseNotes(md: string): { title: string; points: string[] } {
  const lines = md.split('\n').map((l) => l.trim()).filter(Boolean)
  const head = lines.find((l) => /^\*\*.+\*\*$/.test(l))
  const points = lines.filter((l) => /^[-*] /.test(l)).map((l) => l.slice(2).replace(/\*\*/g, '').trim())
  return { title: head ? head.replace(/\*\*/g, '') : '', points: points.slice(0, 4) }
}

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* 存不了就每次都问 */ } },
}

/**
 * 有新版本就返回它，没有返回 null。
 * auto=true：启动时的自动检查，受间隔限制，且跳过用户点过“以后再说”的那一版；设置页手动检查不受限。
 * 网络失败：自动检查静默返回 null，手动检查抛出原因。
 */
export async function checkUpdate(auto: boolean): Promise<UpdateInfo | null> {
  if (!tauri) return null
  if (auto && Date.now() - Number(store.get(CHECKED) || 0) < EVERY) return null
  let v: any
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 10_000)
    const r = await fetch(VERSION_URL, { cache: 'no-store', signal: ctl.signal })
    clearTimeout(t)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    v = await r.json()
  } catch (e) {
    if (auto) return null
    throw new Error(`连不上更新服务器（${e instanceof Error && e.name === 'AbortError' ? '超时' : (e as Error).message}）`)
  }
  const st: UpdateState = await call('update_status')
  // 只有“已是最新”才记下检查时间：有新版本时每次打开都提示，直到装上或点“以后再说”
  if (!v?.version || !st.current || cmpVersion(v.version, st.current) <= 0) { store.set(CHECKED, String(Date.now())); return null }
  if (auto && store.get(SKIP) === v.version) return null
  const urls = [v.mirror?.android_arm64_url, v.android_arm64_url].filter((u): u is string => typeof u === 'string' && u.startsWith('https://'))
  if (!urls.length) return null
  return { version: v.version, current: st.current, ...parseNotes(v.notes || ''), urls, sha256: v.android_arm64_sha256 || '', size: Number(v.android_arm64_size) || 0 }
}

export const skipUpdate = (version: string) => store.set(SKIP, version)
export const currentVersion = async (): Promise<string> => (tauri ? ((await call('update_status')) as UpdateState).current : '')
export const startUpdate = (u: UpdateInfo): Promise<UpdateState> => call('update_start', { urls: u.urls, sha256: u.sha256, size: u.size, version: u.version })
export const updateStatus = (): Promise<UpdateState> => call('update_status')
/** true = 已打开系统安装器；false = 先去系统设置里允许“安装未知应用”，回来再点一次 */
export const installUpdate = async (): Promise<boolean> => !!(await call('update_install'))?.opened

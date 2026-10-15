// 设置页「提醒与小组件」用到的系统能力（仅安卓 App）：小组件个数 / 一键添加、系统通知开关、打开通知设置
const tauri = (globalThis as any).__TAURI__?.core as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined

export type SystemStatus = { widgets: number; canPin: boolean; notify: boolean; kinds?: Record<string, number> }

/** 旧版安装包没有这几个命令：返回 null，设置页按“不知道”显示 */
export async function systemStatus(): Promise<SystemStatus | null> {
  if (!tauri) return null
  try { return await tauri.invoke('plugin:sayday-infer|system_status') } catch { return null }
}
/** 请求把小组件放到桌面（系统弹确认框）。false = 桌面不支持，要手动加 */
export async function pinWidget(kind = 'classic'): Promise<boolean> {
  try { return !!(await tauri?.invoke('plugin:sayday-infer|pin_widget', { kind }))?.ok } catch { return false }
}
/** 小组件上的按钮打开 App 时带的动作（practice / episode / words），取一次就清掉 */
export async function takeLaunchAction(): Promise<string | null> {
  try { return (await tauri?.invoke('plugin:sayday-infer|take_action'))?.action || null } catch { return null }
}
export async function openNotifySettings(): Promise<boolean> {
  try { await tauri?.invoke('plugin:sayday-infer|open_notify_settings'); return !!tauri } catch { return false }
}

/**
 * 要通知权限。通知插件（tauri-plugin-notification 2.4）在安卓 13+ 上“已经允许”时 request_permission 永远不返回，
 * 所以先用自己的 system_status 看开没开；没开才去请求，并且最多等 30 秒，之后再看一次
 */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (!tauri) return false
  if ((await systemStatus())?.notify) return true
  await Promise.race([tauri.invoke('plugin:notification|request_permission').catch(() => null), new Promise((r) => setTimeout(r, 30_000))])
  return !!(await systemStatus())?.notify
}

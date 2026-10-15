// 每日提醒（仅安卓 App，本地定时通知，不连服务器）
// 一次排好接下来 7 天、每天一条；今天已经练过就跳过今天。每次打开 App、做完练习都重排一遍：
// 这样几天不打开也还有提醒，练过的那天不会再被催。
import { db, kvGet, kvSet, today } from './db'
import { dayRow } from './lesson'
import { dueCount } from './srs'
import { getProgress, loadSeasons, nextUp } from './episodes'

const tauri = (globalThis as any).__TAURI__?.core as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined
export const canRemind = !!tauri
export type Reminder = { on: boolean; hour: number; minute: number }
export const getReminder = () => kvGet<Reminder>('reminder', { on: false, hour: 20, minute: 30 })
const IDS = [7101, 7102, 7103, 7104, 7105, 7106, 7107]

export async function enableReminder(r: Reminder): Promise<string | null> {
  if (!tauri) return '网页版不支持定时提醒，请用安卓 App'
  if (r.on) {
    const st = await tauri.invoke('plugin:notification|request_permission').catch(() => 'denied')
    if (st !== 'granted') return '没有通知权限：到系统设置 → 应用 → 日日说 → 通知 里打开'
  }
  await kvSet('reminder', r)
  await reschedule()
  return null
}

/**
 * 和 Emma 聊过天的人：提醒用 Emma 的口吻（第一天用她还没被看的那条主动消息，之后按性格轮换模板）。
 * 没聊过的人和以前一样
 */
async function emmaLines(n: number): Promise<string[] | null> {
  const { getPersona, unreadNudge, NUDGE_LINES } = await import('./companion')
  const said = (await db.one<{ n: number }>("SELECT count(*) n FROM chat WHERE role = 'user'"))?.n ?? 0
  if (!said) return null
  const lines = NUDGE_LINES[await getPersona()]
  const first = await unreadNudge()
  const start = Math.floor(Date.now() / 86400_000)
  return Array.from({ length: n }, (_, k) => (k === 0 && first ? `Emma：${first.text}` : `Emma：${lines[(start + k) % lines.length]}`))
}

/** 提醒文案：有剧集就用剧集勾人，没有就说到期的词 */
async function body(): Promise<string> {
  try {
    const [all, p] = await Promise.all([loadSeasons(), getProgress()])
    const u = nextUp(all, p)
    if (u.state !== 'all-done') return `第 ${u.ep.id} 集《${u.ep.title}》在等你 · 忙的话 2 分钟也算数`
  } catch { /* 剧集没加载出来就用下面的 */ }
  const due = await dueCount(Date.now() + 86400_000)
  return due ? `有 ${due} 个词快忘了，趁现在复习一下` : '今天开口说几句吧，2 分钟也算数'
}

export async function reschedule() {
  if (!tauri) return
  // 桌面小组件和提醒同一时机更新（打开 App、做完练习）
  import('./widget').then((m) => m.updateWidget()).catch(() => {})
  const r = await getReminder()
  await tauri.invoke('plugin:notification|cancel', { notifications: IDS }).catch(() => {})
  if (!r.on) return
  const d = await dayRow(today())
  const practiced = d.reviews + d.new_words + d.shadows + (d.listens ?? 0) > 0
  const text = await body()
  const emma = await emmaLines(IDS.length).catch(() => null)
  const now = new Date()
  let sent = 0 // Emma 那条主动消息放在实际排上的第一条提醒里
  for (let k = 0; k < IDS.length; k++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, r.hour, r.minute)
    if (k === 0 && (practiced || at.getTime() < now.getTime() + 60_000)) continue
    await tauri.invoke('plugin:notification|notify', {
      options: { id: IDS[k], title: '日日说', body: emma?.[sent++] ?? text, autoCancel: true, schedule: { at: { date: at.toISOString(), repeating: false, allowWhileIdle: true } } },
    }).catch(() => {})
  }
}

// 安卓桌面小组件：网页这边算好要显示的内容，交给原生插件存起来并刷新小组件（小组件读不到 App 里的数据库）
// 打开 App、做完练习时更新（和每日提醒重排是同一时机）；过了零点（按凌晨 4 点换日）小组件自己显示“今天还没练”
import { db, today } from './db'
import { dayRow } from './lesson'
import { loadContent } from './content'
import { currentWeek } from './rhythm'

const tauri = (globalThis as any).__TAURI__?.core as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined

const active = (r: { reviews: number; new_words: number; shadows: number; listens: number }) => r.reviews + r.new_words + r.shadows + (r.listens ?? 0) > 0

/** 连续练习天数：从今天（今天没练就从昨天）往前数，每天有任何练习都算 */
export function streakOf(days: { date: string; active: boolean }[], now = today()): number {
  const set = new Set(days.filter((d) => d.active).map((d) => d.date))
  const prev = (s: string) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  let d = set.has(now) ? now : prev(now)
  let n = 0
  while (set.has(d)) { n++; d = prev(d) }
  return n
}

/** 当前连续天数（小组件老版本的兜底标题） */
export async function currentStreak(): Promise<number> {
  const rows = await db.all<{ date: string; reviews: number; new_words: number; shadows: number; listens: number }>('SELECT date, reviews, new_words, shadows, listens FROM day ORDER BY date DESC LIMIT 400')
  return streakOf(rows.map((r) => ({ date: r.date, active: active(r) })))
}

/** 小组件的种类（和原生那边的 Provider 一一对应；pin_widget 按这个名字找） */
export const WIDGET_KINDS = [
  { kind: 'week', name: '本周', cols: 4, rows: 2, desc: '本周七天哪天练了、离达标还差几天，一键开练' },
  { kind: 'today', name: '今天', cols: 2, rows: 2, desc: '本周练了几天 + 今天练没练' },
  { kind: 'word', name: '单词卡', cols: 4, rows: 2, desc: '在学的词：音标、意思、例句，点“换一个”看下一个' },
  { kind: 'episode', name: '今日剧集', cols: 4, rows: 2, desc: '今天这一集的标题和看点，点开直接看' },
  { kind: 'mini', name: '开练', cols: 1, rows: 1, desc: '一个按钮：今天练过显示 ✓，点开直接开始练习' },
  { kind: 'classic', name: '综合', cols: 3, rows: 2, desc: '本周进度、今天练了什么、一个在学的词' },
] as const
export type WidgetKind = (typeof WIDGET_KINDS)[number]['kind']

export type WidgetData = {
  date: string; weekEnd: string
  week: { lit: number; goal: number; met: boolean; streak: number; days: { d: string; date: string; lit: boolean; today: boolean; future: boolean }[] }
  head: string; practiced: boolean; done: boolean; main: string; sub: string
  words: { w: string; ipa: string; zh: string; ex: string; exZh: string }[]
  ep: { label: string; title: string; zh: string; ready: boolean } | null
}
const WD = ['一', '二', '三', '四', '五', '六', '日']

/** 小组件要显示的全部内容（App 里的“桌面小组件”页预览也用它，看到的就是桌面上的样子） */
export async function widgetData(): Promise<WidgetData> {
  const d = await dayRow()
  const wk = await currentWeek()
  const practiced = active(d)
  const t = today()
  const parts = [d.reviews && `复习 ${d.reviews}`, d.new_words && `新词 ${d.new_words}`, d.listens && `听力 ${d.listens}`, d.shadows && `跟读 ${d.shadows}`].filter(Boolean)
  // 在学的词：还没熟的里面最近加入的几个，带一句短例句
  const { byWord, sentsByWord } = await loadContent()
  const cards = await db.all<{ word: string }>('SELECT word FROM card WHERE known = 0 ORDER BY (state = 2), added DESC LIMIT 12')
  const words = cards.map((c) => byWord.get(c.word)).filter(Boolean).slice(0, 8).map((w) => {
    const ex = (sentsByWord.get(w!.w) ?? []).filter((x) => x.en.length <= 70).sort((a, b) => a.en.length - b.en.length)[0]
    return { w: w!.w, ipa: w!.ipa, zh: w!.zh.split(/[；;]/)[0], ex: ex?.en ?? '', exZh: ex?.zh ?? '' }
  })
  let ep: WidgetData['ep'] = null
  try {
    const { getProgress, loadSeasons, nextUp, teaserFor } = await import('./episodes')
    const [all, p] = await Promise.all([loadSeasons(), getProgress()])
    const u = nextUp(all, p)
    if (u.state !== 'all-done') ep = { label: `${u.season.season > 1 ? `第 ${u.season.season} 季 ` : ''}第 ${u.ep.id} 集 · ${u.ep.level}`, title: u.ep.title, zh: u.state === 'ready' ? u.ep.scene_zh : teaserFor(all, u.season.season, u.ep.id), ready: u.state === 'ready' }
  } catch { /* 剧集没载入就不显示 */ }
  return {
    date: t, weekEnd: wk.days[6].date,
    week: { lit: wk.lit, goal: wk.goal, met: wk.met, streak: wk.streak, days: wk.days.map((x, i) => ({ d: WD[i], date: x.date, lit: x.lit, today: x.date === t, future: x.date > t })) },
    head: wk.met ? (wk.streak > 1 ? `本周达标 · 连续 ${wk.streak} 周` : '本周达标') : `本周练了 ${wk.lit}/${wk.goal} 天`,
    practiced, done: !!d.done,
    main: d.done ? '今天练完了 ✓' : practiced ? '今天练了一些' : '今天还没练',
    sub: parts.length ? parts.join(' · ') : '累的话 2 分钟也算数',
    words, ep,
  }
}

/** 推给原生：新版小组件读 json；老字段留着给还没更新的旧版原生代码 */
export async function updateWidget() {
  if (!tauri) return
  const x = await widgetData()
  const w = x.words[0]
  await tauri.invoke('plugin:sayday-infer|update_widget', {
    widget: {
      date: x.date, streak: await currentStreak(), head: x.head, headUntil: x.weekEnd, practiced: x.practiced, main: x.main, sub: x.sub,
      word: w?.w ?? '', meaning: w ? `${w.ipa ? `/${w.ipa}/ ` : ''}${w.zh}` : '',
      json: JSON.stringify(x),
    },
  }).catch(() => {})
}

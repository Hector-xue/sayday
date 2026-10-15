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

export async function updateWidget() {
  if (!tauri) return
  const d = await dayRow()
  const streak = await currentStreak()
  const wk = await currentWeek()
  const practiced = active(d)
  // 一个最近在学的词（还没熟的里面最近加入的），显示释义帮着回想
  const card = await db.one<{ word: string }>('SELECT word FROM card WHERE known = 0 AND state != 2 ORDER BY added DESC LIMIT 1')
    ?? await db.one<{ word: string }>('SELECT word FROM card WHERE known = 0 ORDER BY due LIMIT 1')
  const w = card ? (await loadContent()).byWord.get(card.word) : undefined
  const parts = [d.reviews && `复习 ${d.reviews}`, d.new_words && `新词 ${d.new_words}`, d.listens && `听力 ${d.listens}`, d.shadows && `跟读 ${d.shadows}`].filter(Boolean)
  await tauri.invoke('plugin:sayday-infer|update_widget', {
    widget: {
      date: today(),
      streak,
      // 标题按周目标：一周练 4 天算达标，不按天连续
      head: wk.met ? (wk.streak > 1 ? `本周达标 · 连续 ${wk.streak} 周` : '本周达标') : `本周练了 ${wk.lit}/${wk.goal} 天`,
      headUntil: wk.days[6].date,
      practiced,
      main: d.done ? '今天练完了 ✓' : practiced ? '今天练了一些' : '今天还没练',
      sub: parts.length ? parts.join(' · ') : '累的话 2 分钟也算数',
      word: w?.w ?? '',
      meaning: w ? `${w.ipa ? `/${w.ipa}/ ` : ''}${w.zh.split(/[；;]/)[0]}` : '',
    },
  }).catch(() => {})
}

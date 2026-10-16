// 里程碑：练习天数、在学的词、跟读句数、连续达标周数、第一次跟读上 90 分。
// 到了就弹一次庆祝页（可以存一张分享图）；看过记在 kv 'milestones_seen'。
// 老用户第一次用到这个功能时，已经达成的全部记为看过，不会一下子弹一串。
import { db, kvGet, kvSet } from './db'
import { currentWeek } from './rhythm'

export type MilestoneKind = 'days' | 'words' | 'shadows' | 'weeks' | 'score'
export type Milestone = { id: string; kind: MilestoneKind; n: number; big: string; unit: string; title: string; line: string }

export const STEPS: Record<Exclude<MilestoneKind, 'score'>, number[]> = {
  days: [3, 7, 14, 30, 50, 100, 200, 365, 500, 1000],
  words: [50, 100, 300, 500, 1000, 2000, 3000, 5000, 8000],
  shadows: [50, 100, 300, 500, 1000, 2000],
  weeks: [2, 4, 8, 12, 26, 52],
}

export type Ctx = { days: number; words: number; shadows: number; weeks: number; best: number }

function make(kind: MilestoneKind, n: number): Milestone {
  switch (kind) {
    case 'days': return { id: `days-${n}`, kind, n, big: String(n), unit: '天', title: `练了 ${n} 天`, line: n <= 7 ? '不用天天来，来了就算数。' : '这些天加起来，就是你和英语的距离在变短。' }
    case 'words': return { id: `words-${n}`, kind, n, big: n.toLocaleString(), unit: '个词', title: `在学的词到 ${n.toLocaleString()} 个`, line: n >= 3000 ? '日常对话里的大多数词，你都见过了。' : '每个都带着例句和发音进了你的脑子。' }
    case 'shadows': return { id: `shadows-${n}`, kind, n, big: n.toLocaleString(), unit: '句', title: `开口跟读了 ${n.toLocaleString()} 句`, line: '说得多了，嘴会记住那些音。' }
    case 'weeks': return { id: `weeks-${n}`, kind, n, big: String(n), unit: '周', title: `连续 ${n} 周达标`, line: '每周练够 4 天，一周没落下。' }
    case 'score': return { id: 'score-90', kind, n, big: String(n), unit: '分', title: `第一次有一句读到 ${n} 分`, line: '这一句，已经很像母语者了。' }
  }
}

/** 按当前数据，已经达成的全部里程碑（每类从小到大） */
export function reached(c: Ctx): Milestone[] {
  const out: Milestone[] = []
  for (const k of ['days', 'words', 'shadows', 'weeks'] as const) for (const n of STEPS[k]) if (c[k] >= n) out.push(make(k, n))
  if (c.best >= 90) out.push(make('score', c.best))
  return out
}

/** 一次只庆祝一个：没看过的里面挑“最大”的那个（同类取最高档；不同类按这个顺序） */
const ORDER: MilestoneKind[] = ['days', 'weeks', 'words', 'score', 'shadows']
export function pick(unseen: Milestone[]): Milestone | null {
  for (const k of ORDER) {
    const xs = unseen.filter((m) => m.kind === k)
    if (xs.length) return xs[xs.length - 1]
  }
  return null
}

export async function milestoneCtx(): Promise<Ctx> {
  const one = async (sql: string) => (await db.one<{ n: number | null }>(sql))?.n ?? 0
  const [days, words, shadows, best, wk] = await Promise.all([
    one('SELECT count(*) n FROM day WHERE reviews + new_words + shadows + listens > 0'),
    one('SELECT count(*) n FROM card WHERE known = 0'),
    one('SELECT count(*) n FROM attempt'),
    one('SELECT max(score) n FROM attempt'),
    currentWeek(),
  ])
  return { days, words, shadows, best, weeks: wk.streak }
}

/**
 * 有没有新的里程碑要庆祝。返回要弹的那一个（没看过的同时记为看过：同一批里别的就不再弹了）。
 * 第一次调用（从没记过）：把已经达成的全记为看过，返回 null。
 */
export async function nextMilestone(c?: Ctx): Promise<Milestone | null> {
  const ctx = c ?? (await milestoneCtx())
  const all = reached(ctx)
  const seen = await kvGet<string[] | null>('milestones_seen', null)
  if (seen === null) { await kvSet('milestones_seen', all.map((m) => m.id)); return null }
  const s = new Set(seen)
  // 跟读分只庆祝第一次上 90（id 固定 score-90）
  const fresh = all.filter((m) => !s.has(m.id))
  if (!fresh.length) return null
  await kvSet('milestones_seen', [...seen, ...fresh.map((m) => m.id)])
  return pick(fresh)
}

/** 分享图：1080×1350 竖版卡片（荧光笔黄 + 大数字 + 一句话 + 日期） */
export async function shareCard(m: Milestone, now = new Date()): Promise<Blob> {
  const W = 1080, H = 1350
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')!
  const sans = '"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif'
  g.fillStyle = '#F7F6F2'; g.fillRect(0, 0, W, H)
  // 大数字（字号按宽度缩到放得下，单位跟在后面）+ 下半截一道荧光笔
  g.font = `700 64px ${sans}`
  const uw = g.measureText(m.unit).width
  let fs = 340
  for (; fs > 120; fs -= 10) { g.font = `800 ${fs}px ${sans}`; if (g.measureText(m.big).width + 24 + uw <= W - 232) break }
  const bw = g.measureText(m.big).width
  const base = 700
  g.fillStyle = '#FFE14A'
  g.fillRect(100, base - fs * 0.36, bw + 32, fs * 0.42)
  g.fillStyle = '#141413'
  g.fillText(m.big, 116, base)
  g.font = `700 64px ${sans}`
  g.fillText(m.unit, 116 + bw + 24, base)
  g.font = `700 76px ${sans}`
  wrap(g, m.title, 116, 860, W - 232, 96)
  g.fillStyle = '#5C5B56'; g.font = `400 44px ${sans}`
  wrap(g, m.line, 116, 1000, W - 232, 64)
  g.fillStyle = '#8E8D86'; g.font = `500 36px ${sans}`
  g.fillText(`${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`, 116, 200)
  g.fillStyle = '#141413'; g.font = `800 52px ${sans}`
  g.fillText('日日说', 116, H - 120)
  g.fillStyle = '#8E8D86'; g.font = `500 36px ${sans}`
  g.fillText('sayday · 每天说一点英语', 290, H - 122)
  return new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('生成图片失败'))), 'image/png'))
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  let line = ''
  for (const ch of text) {
    if (g.measureText(line + ch).width > max && line) { g.fillText(line, x, y); y += lh; line = ch } else line += ch
  }
  if (line) g.fillText(line, x, y)
}

/** 存图：App 里写进系统“下载”；网页能分享就弹系统分享，不能就下载 */
export async function saveCard(m: Milestone): Promise<string> {
  const blob = await shareCard(m)
  const name = `日日说-${m.id}.png`
  const tauri = (globalThis as any).__TAURI__?.core
  if (tauri) {
    const u8 = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as unknown as number[])
    const r = await tauri.invoke('plugin:sayday-infer|save_to_downloads', { name, mime: 'image/png', data: btoa(bin) })
    return '图片已保存到 ' + r.path
  }
  const file = new File([blob], name, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return '' } catch (e) { if ((e as Error).name === 'AbortError') return '' }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  return '图片已下载'
}

// 统一刻度：CEFR。词汇量 → 档位、雅思对照、累计学时（方案第 13 节）
export const CEFR = ['Pre-A1', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
export type Cefr = (typeof CEFR)[number]

/** 认识的常用词（前 1.2 万）→ 档位。按词频排名的估算，界面标“估算” */
const VOCAB_CUTS: [number, Cefr][] = [[500, 'Pre-A1'], [1500, 'A1'], [2500, 'A2'], [3500, 'B1'], [5000, 'B2'], [8000, 'C1']]
export function cefrFromVocab(v: number): Cefr {
  for (const [cut, c] of VOCAB_CUTS) if (v < cut) return c
  return 'C2'
}
/** 档位对应的词汇量下限（给“离下一档还差多少词”用） */
export function vocabFloor(c: Cefr): number {
  if (c === 'Pre-A1') return 0
  const i = VOCAB_CUTS.findIndex(([, x]) => x === c)
  return i <= 0 ? 0 : VOCAB_CUTS[i - 1][0]
}
export function nextCefr(c: Cefr): Cefr | null {
  const i = CEFR.indexOf(c)
  return i < CEFR.length - 1 ? CEFR[i + 1] : null
}

/** 雅思 ↔ CEFR（官方对照：4.0–5.0≈B1，5.5–6.5≈B2，7.0–8.0≈C1，8.5+≈C2） */
export function cefrFromIelts(band: number): Cefr {
  if (band >= 8.5) return 'C2'
  if (band >= 7) return 'C1'
  if (band >= 5.5) return 'B2'
  if (band >= 4) return 'B1'
  return 'A2'
}
export function ieltsLabel(c: Cefr): string {
  return { 'Pre-A1': '—', A1: '约 3.0', A2: '约 3.5', B1: '4.0–5.0', B2: '5.5–6.5', C1: '7.0–8.0', C2: '8.5+' }[c]
}

/** Cambridge 累计指导学时（取区间中值），用来估“还差多久” */
const HOURS: Record<Cefr, number> = { 'Pre-A1': 0, A1: 90, A2: 190, B1: 375, B2: 550, C1: 750, C2: 1000 }
export function hoursBetween(from: Cefr, to: Cefr) { return Math.max(0, HOURS[to] - HOURS[from]) }

/** 按每天分钟数估达成日；进度按剩余学时算（不按档位平均） */
export function eta(from: Cefr, to: Cefr, minutesPerDay: number, start: Cefr = from) {
  const left = hoursBetween(from, to)
  const total = hoursBetween(start, to) || 1
  const days = Math.ceil((left * 60) / Math.max(5, minutesPerDay))
  const d = new Date(Date.now() + days * 86400_000)
  return { hoursLeft: left, days, date: `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`, progress: 1 - left / total }
}

export type Goal = { kind: 'ielts' | 'scene' | 'custom'; ielts?: number; scene?: string; target: Cefr }
export const SCENES: { id: string; label: string; target: Cefr }[] = [
  { id: 'travel', label: '出国旅游能应付', target: 'A2' },
  { id: 'daily', label: '日常交流不卡壳', target: 'B1' },
  { id: 'show', label: '看美剧不开字幕', target: 'B2' },
  { id: 'work', label: '工作里开会、写邮件', target: 'B2' },
  { id: 'fluent', label: '接近母语的流利', target: 'C1' },
]
export function goalLabel(g: Goal): string {
  if (g.kind === 'ielts') return `雅思 ${g.ielts}`
  if (g.kind === 'scene') return SCENES.find((s) => s.id === g.scene)?.label ?? g.target
  return g.target
}

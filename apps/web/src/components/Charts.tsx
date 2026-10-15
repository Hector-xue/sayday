// 进步页的两张小图：雅思四项雷达、词汇量曲线。纯 SVG，颜色走主题变量

/** 四项雷达：0~9 分；now 实线填色，before（四周前）虚线 */
export function Radar({ axes, now, before }: { axes: string[]; now: (number | null)[]; before?: (number | null)[] }) {
  // 左右留宽：标签“听力 6.0”横着放在两侧
  const W = 300, H = 220, cx = W / 2, cy = H / 2, R = 78
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length
    const r = (Math.max(0, Math.min(9, v)) / 9) * R
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  const poly = (vs: (number | null)[]) => vs.map((v, i) => pt(i, v ?? 0).join(',')).join(' ')
  return (
    <svg className="radar" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="雅思四项预估雷达图">
      {[3, 5, 7, 9].map((g) => <polygon key={g} className="grid" points={axes.map((_, i) => pt(i, g).join(',')).join(' ')} />)}
      {axes.map((_, i) => { const [x, y] = pt(i, 9); return <line key={i} className="grid" x1={cx} y1={cy} x2={x} y2={y} /> })}
      {before && before.some((v) => v != null) && <polygon className="before" points={poly(before)} />}
      <polygon className="now" points={poly(now)} />
      {now.map((v, i) => v != null && (() => { const [x, y] = pt(i, v); return <circle key={i} className="dot" cx={x} cy={y} r={3.5} /> })())}
      {axes.map((t, i) => {
        const [x, y] = pt(i, 11.6)
        return <text key={t} x={x} y={y} textAnchor="middle" dominantBaseline="middle">{t} {now[i] != null ? now[i]!.toFixed(1) : '—'}</text>
      })}
    </svg>
  )
}

/** 折线：x = 时间，y = 数值；首尾标数值 */
export function Line({ pts, unit = '' }: { pts: { ts: number; v: number }[]; unit?: string }) {
  if (pts.length < 2) return null
  const W = 320, H = 120, P = { l: 8, r: 8, t: 18, b: 18 }
  const t0 = pts[0].ts, t1 = pts[pts.length - 1].ts || t0 + 1
  const vs = pts.map((p) => p.v)
  const lo = Math.min(...vs), hi = Math.max(...vs)
  const pad = Math.max(1, (hi - lo) * 0.15)
  const x = (t: number) => P.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r)
  const y = (v: number) => P.t + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - P.t - P.b)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const md = (t: number) => { const dt = new Date(t); return `${dt.getMonth() + 1}/${dt.getDate()}` }
  const first = pts[0], last = pts[pts.length - 1]
  return (
    <svg className="line-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="曲线">
      <path className="area" d={`${d} L${x(last.ts)},${H - P.b} L${x(first.ts)},${H - P.b} Z`} />
      <path className="stroke" d={d} />
      {pts.map((p) => <circle key={p.ts} className="dot" cx={x(p.ts)} cy={y(p.v)} r={2.5} />)}
      <text x={x(first.ts)} y={y(first.v) - 7} textAnchor="start">{first.v.toLocaleString()}{unit}</text>
      <text x={x(last.ts)} y={y(last.v) - 7} textAnchor="end">{last.v.toLocaleString()}{unit}</text>
      <text className="axis" x={P.l} y={H - 4} textAnchor="start">{md(first.ts)}</text>
      <text className="axis" x={W - P.r} y={H - 4} textAnchor="end">{md(last.ts)}</text>
    </svg>
  )
}

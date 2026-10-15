// 雅思学术类小作文的图表：折线 / 柱状 / 饼图 / 表格，按题目里的数据现画（SVG，跟随深浅色）
import type { ChartData, ChartType } from '../lib/ielts-chart'

const COLORS = ['#3a6ea5', '#d9822b', '#4a9a5b', '#b0413e', '#7d5ba6', '#8c8c8c']

export function IeltsChart({ type, c }: { type: ChartType; c: ChartData }) {
  if (type === 'table') return (
    <div className="ielts-chart">
      <p className="chart-title en">{c.title}</p>
      <table className="chart-table en">
        <thead><tr><th /> {c.x.map((x) => <th key={x}>{x}</th>)}</tr></thead>
        <tbody>{c.series.map((s) => <tr key={s.name}><th>{s.name}</th>{s.values.map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
  if (type === 'pie') return (
    <div className="ielts-chart">
      <p className="chart-title en">{c.title}</p>
      <div className="pies">
        {c.x.map((year, k) => {
          let a = -Math.PI / 2
          const total = c.series.reduce((t, s) => t + s.values[k], 0)
          return (
            <svg key={year} viewBox="0 0 120 132" className="pie">
              {c.series.map((s, i) => {
                const v = s.values[k] / total, a2 = a + v * 2 * Math.PI
                const p = (t: number) => `${60 + 50 * Math.cos(t)},${60 + 50 * Math.sin(t)}`
                const d = `M60,60 L${p(a)} A50,50 0 ${v > 0.5 ? 1 : 0} 1 ${p(a2)} Z`
                const mid = (a + a2) / 2
                a = a2
                return <g key={s.name}><path d={d} fill={COLORS[i % COLORS.length]} stroke="var(--surface)" strokeWidth="1" />{v >= 0.07 && <text x={60 + 33 * Math.cos(mid)} y={60 + 33 * Math.sin(mid)} textAnchor="middle" dominantBaseline="middle" className="pie-pct">{s.values[k]}%</text>}</g>
              })}
              <text x="60" y="126" textAnchor="middle" className="axis-t">{year}</text>
            </svg>
          )
        })}
      </div>
      <Legend c={c} />
    </div>
  )
  // 折线 / 柱状：共用坐标轴
  const W = 320, H = 190, L = 34, R = 8, T = 10, B = 26
  const max = Math.max(...c.series.flatMap((s) => s.values))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const y = (v: number) => T + (1 - v / top) * (H - T - B)
  const n = c.x.length
  const slot = (W - L - R) / n
  const xc = (i: number) => L + slot * i + slot / 2
  return (
    <div className="ielts-chart">
      <p className="chart-title en">{c.title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="axes">
        {Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step).map((v) => (
          <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid-l" /><text x={L - 4} y={y(v)} textAnchor="end" dominantBaseline="middle" className="axis-t">{v}</text></g>
        ))}
        {c.x.map((x, i) => <text key={x} x={xc(i)} y={H - 8} textAnchor="middle" className="axis-t">{x}</text>)}
        {type === 'line'
          ? c.series.map((s, k) => (
            <g key={s.name}>
              <polyline fill="none" stroke={COLORS[k]} strokeWidth="2" points={s.values.map((v, i) => `${xc(i)},${y(v)}`).join(' ')} />
              {s.values.map((v, i) => <circle key={i} cx={xc(i)} cy={y(v)} r="2.6" fill={COLORS[k]} />)}
            </g>
          ))
          : c.series.map((s, k) => {
            const bw = (slot * 0.8) / c.series.length
            return s.values.map((v, i) => <rect key={`${k}-${i}`} x={L + slot * i + slot * 0.1 + bw * k} y={y(v)} width={bw - 1} height={y(0) - y(v)} fill={COLORS[k]} />)
          })}
      </svg>
      <Legend c={c} />
    </div>
  )
}

function Legend({ c }: { c: ChartData }) {
  return <div className="chart-legend en">{c.series.map((s, i) => <span key={s.name}><i style={{ background: COLORS[i % COLORS.length] }} />{s.name}</span>)}</div>
}

function niceStep(max: number) {
  const raw = max / 5, p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw
}


// 雅思小作文图表的数据（content/ielts/writing.json 的 task1.chart）
export type ChartData = { title: string; unit: string; x: string[]; series: { name: string; values: number[] }[] }
export type ChartType = 'line' | 'bar' | 'pie' | 'table'

/** 给 AI 批改用：把图表数据写成文字 */
export function chartAsText(type: ChartType, c: ChartData): string {
  return `${type} chart: ${c.title} (unit: ${c.unit})\n` + c.series.map((s) => `${s.name}: ` + c.x.map((x, i) => `${x}=${s.values[i]}`).join(', ')).join('\n')
}

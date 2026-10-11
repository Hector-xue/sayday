// 语调：YIN 提基频 → 换成相对自己中位音高的半音 → 首尾去静音、时间拉齐到 0~1，和示范叠在一起看
// 只比“形状”（升降起伏），不比绝对音高：男女声、高低嗓都能比

/** YIN 基频（Hz），每 10ms 一帧；不发声的帧为 null */
export function yin(x: Float32Array, sr = 16000, fmin = 70, fmax = 420, th = 0.15): (number | null)[] {
  const hop = Math.round(sr / 100), W = Math.round(sr * 0.04)
  const tauMin = Math.floor(sr / fmax), tauMax = Math.min(Math.ceil(sr / fmin), W - 1)
  let peak = 0
  for (const v of x) peak = Math.max(peak, Math.abs(v))
  const out: (number | null)[] = []
  const d = new Float32Array(tauMax + 1)
  for (let s = 0; s + W + tauMax < x.length; s += hop) {
    let e = 0
    for (let i = 0; i < W; i++) e += x[s + i] * x[s + i]
    if (Math.sqrt(e / W) < peak * 0.04) { out.push(null); continue }
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0
      for (let i = 0; i < W; i++) { const df = x[s + i] - x[s + i + tau]; sum += df * df }
      d[tau] = sum
    }
    // 累积平均归一化差函数
    let run = 0, best = -1
    for (let tau = 1; tau <= tauMax; tau++) {
      run += d[tau]
      const v = run ? (d[tau] * tau) / run : 1
      d[tau] = v
    }
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < th) { while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++; best = tau; break }
    }
    out.push(best > 0 ? sr / best : null)
  }
  return out
}

const median = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b.length ? b[b.length >> 1] : 0 }

/** 基频 → 半音曲线（相对中位数），去掉首尾不发声段，长度重采样到 n 点；中间的空隙保留为 null */
export function contour(f0: (number | null)[], n = 80): (number | null)[] {
  let s = 0, e = f0.length - 1
  while (s < f0.length && f0[s] === null) s++
  while (e > s && f0[e] === null) e--
  const seg = f0.slice(s, e + 1)
  const voiced = seg.filter((v): v is number => v !== null)
  if (voiced.length < 5) return []
  const med = median(voiced)
  // 5 点中值滤波去掉倍频 / 半频跳点
  const st = seg.map((v) => (v === null ? null : 12 * Math.log2(v / med)))
  const sm = st.map((v, i) => {
    if (v === null) return null
    const w = st.slice(Math.max(0, i - 2), i + 3).filter((x): x is number => x !== null)
    return median(w)
  })
  return Array.from({ length: n }, (_, i) => sm[Math.min(sm.length - 1, Math.round((i / (n - 1)) * (sm.length - 1)))])
}

export type Compare = { sim: number | null; endRef: 'up' | 'down' | 'flat'; endYou: 'up' | 'down' | 'flat'; rangeRef: number; rangeYou: number }

const ending = (c: (number | null)[]): 'up' | 'down' | 'flat' => {
  const v = c.slice(Math.floor(c.length * 0.7)).filter((x): x is number => x !== null)
  if (v.length < 4) return 'flat'
  const d = v.slice(-3).reduce((a, b) => a + b, 0) / 3 - v.slice(0, 3).reduce((a, b) => a + b, 0) / 3
  return d > 1.5 ? 'up' : d < -1.5 ? 'down' : 'flat'
}
const range = (c: (number | null)[]) => {
  const v = c.filter((x): x is number => x !== null).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length * 0.9)] - v[Math.floor(v.length * 0.1)] : 0
}

/** 相似度 = 两条曲线都发声的点上的相关系数 */
export function compare(ref: (number | null)[], you: (number | null)[]): Compare {
  const xs: number[] = [], ys: number[] = []
  for (let i = 0; i < Math.min(ref.length, you.length); i++) if (ref[i] !== null && you[i] !== null) { xs.push(ref[i]!); ys.push(you[i]!) }
  let sim: number | null = null
  if (xs.length >= 10) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length
    let sxy = 0, sxx = 0, syy = 0
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2 }
    sim = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0
  }
  return { sim, endRef: ending(ref), endYou: ending(you), rangeRef: range(ref), rangeYou: range(you) }
}

/** 给一句话的反馈（最多两条，挑最要紧的） */
export function advice(c: Compare): string[] {
  const out: string[] = []
  const zh = { up: '上扬', down: '下降', flat: '持平' }
  if (c.endRef !== c.endYou && c.endRef !== 'flat') out.push(`句尾示范是${zh[c.endRef]}，你读成了${zh[c.endYou]}`)
  if (c.rangeYou < c.rangeRef * 0.55) out.push('起伏偏平：重读的词音调再拉高一点，像在强调它')
  else if (c.rangeYou > c.rangeRef * 1.8) out.push('起伏比示范大很多，可以放松一点')
  if (!out.length && c.sim !== null) out.push(c.sim >= 0.6 ? '升降和示范很接近' : '跟着示范多听几遍，注意哪个词最响')
  return out.slice(0, 2)
}

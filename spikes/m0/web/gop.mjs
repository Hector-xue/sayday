// 免对齐 CTC-GOP（浏览器 / Node 通用，无依赖）
// 输入：模型原始 logits（T×V 行主序 Float32Array）与规范音素 id 序列
// 输出：每个音素的 GOP = log P(规范序列) 在“该位置替换为其他音素/删除”的所有变体中所占的对数份额（≤0，越接近 0 越好）
//
// 实现：规范序列的前向 α / 后向 β 各算一次；每个变体只在第 i 个位置与规范序列不同，
// 它的似然可以由 α（前缀）+ 中间那个状态的小递推 + β（后缀）拼出来，单个变体 O(T)，整句 O(N·K·T)。

export const BLANK = 41
export const SIL = 0
const NEG = -Infinity

const lse = (a, b) => (a === NEG ? b : b === NEG ? a : a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b)))

/** log-softmax，并把 [SIL] 并入 blank（停顿不算任何音素） */
export function prepare(logits, T, V) {
  const lp = new Float64Array(T * V)
  for (let t = 0; t < T; t++) {
    let m = NEG
    for (let v = 0; v < V; v++) m = Math.max(m, logits[t * V + v])
    let s = 0
    for (let v = 0; v < V; v++) s += Math.exp(logits[t * V + v] - m)
    const z = m + Math.log(s)
    for (let v = 0; v < V; v++) lp[t * V + v] = logits[t * V + v] - z
    lp[t * V + BLANK] = lse(lp[t * V + BLANK], lp[t * V + SIL])
    lp[t * V + SIL] = NEG
  }
  return lp
}

function extend(seq) {
  const S = 2 * seq.length + 1
  const ext = new Int32Array(S)
  for (let s = 0; s < S; s++) ext[s] = s % 2 === 0 ? BLANK : seq[(s - 1) >> 1]
  return ext
}

/** 前向表 α[t*S+s]：在 t 时刻处于扩展状态 s 且已发出 0..t 帧的对数概率 */
function forward(lp, T, V, ext) {
  const S = ext.length
  const a = new Float64Array(T * S).fill(NEG)
  a[0] = lp[ext[0]]
  if (S > 1) a[1] = lp[ext[1]]
  for (let t = 1; t < T; t++) {
    const p = (t - 1) * S, c = t * S, row = t * V
    for (let s = 0; s < S; s++) {
      let x = a[p + s]
      if (s >= 1) x = lse(x, a[p + s - 1])
      if (s >= 2 && ext[s] !== BLANK && ext[s] !== ext[s - 2]) x = lse(x, a[p + s - 2])
      a[c + s] = x === NEG ? NEG : x + lp[row + ext[s]]
    }
  }
  return a
}

/** 后向表 β[t*S+s]：在 t 时刻处于 s，发出 t..T-1 帧并合法结束的对数概率（含 t 帧发射） */
function backward(lp, T, V, ext) {
  const S = ext.length
  const b = new Float64Array(T * S).fill(NEG)
  const last = (T - 1) * S
  b[last + S - 1] = lp[(T - 1) * V + ext[S - 1]]
  if (S > 1) b[last + S - 2] = lp[(T - 1) * V + ext[S - 2]]
  for (let t = T - 2; t >= 0; t--) {
    const n = (t + 1) * S, c = t * S, row = t * V
    for (let s = 0; s < S; s++) {
      let x = b[n + s]
      if (s + 1 < S) x = lse(x, b[n + s + 1])
      if (s + 2 < S && ext[s + 2] !== BLANK && ext[s + 2] !== ext[s]) x = lse(x, b[n + s + 2])
      b[c + s] = x === NEG ? NEG : x + lp[row + ext[s]]
    }
  }
  return b
}

/** CTC 前向：log P(seq | lp)（参考实现，用于校验） */
export function ctcLogLik(lp, T, V, seq) {
  const ext = extend(seq)
  const S = ext.length
  const a = forward(lp, T, V, ext)
  return S > 1 ? lse(a[(T - 1) * S + S - 1], a[(T - 1) * S + S - 2]) : a[(T - 1) * S]
}

/** 逐音素 GOP；phoneIds 为可替换的音素集合（不含 blank/SIL） */
export function afGop(lp, T, V, seq, phoneIds) {
  const N = seq.length
  const ext = extend(seq)
  const S = ext.length
  const A = forward(lp, T, V, ext)
  const B = backward(lp, T, V, ext)
  const canon = lse(A[(T - 1) * S + S - 1], A[(T - 1) * S + S - 2])
  const al = (t, s) => (t < 0 || s < 0 ? NEG : A[t * S + s])
  const be = (t, s) => (t >= T || s >= S ? NEG : B[t * S + s])
  const out = new Float64Array(N)

  for (let i = 0; i < N; i++) {
    const tok = 2 * i + 1 // 第 i 个音素的扩展状态
    const prevTok = i > 0 ? seq[i - 1] : -1
    const nextTok = i < N - 1 ? seq[i + 1] : -1
    let acc = canon

    // 替换：中间状态换成 q，γ(t) = 在 t 时刻处于 q 的前向概率
    for (const q of phoneIds) {
      if (q === seq[i]) continue
      let g = NEG, total = NEG
      for (let t = 0; t < T; t++) {
        let enter
        if (t === 0) enter = i === 0 ? 0 : NEG
        else {
          enter = lse(g, al(t - 1, tok - 1))
          if (q !== prevTok) enter = lse(enter, al(t - 1, tok - 2))
        }
        g = enter === NEG ? NEG : enter + lp[t * V + q]
        if (g === NEG) continue
        let exit = be(t + 1, tok + 1)
        if (q !== nextTok) exit = lse(exit, be(t + 1, tok + 2))
        if (t === T - 1 && i === N - 1) exit = lse(exit, 0) // 以最后一个音素结束
        total = lse(total, g + exit)
      }
      acc = lse(acc, total)
    }

    // 删除：前缀（到 seq[i-1] 或其后的 blank）直接接后缀（从 seq[i+1] 开始）
    let del = NEG
    if (N === 1) {
      del = 0
      for (let t = 0; t < T; t++) del += lp[t * V + BLANK]
    } else if (i === N - 1) {
      del = lse(al(T - 1, tok - 1), al(T - 1, tok - 2))
    } else {
      if (i === 0) del = be(0, tok + 2) // 一开始就直接进入 seq[1]
      for (let t = 0; t < T - 1; t++) {
        let pre = al(t, tok - 1)
        if (i > 0 && prevTok !== nextTok) pre = lse(pre, al(t, tok - 2))
        del = lse(del, pre + be(t + 1, tok + 2))
      }
    }
    acc = lse(acc, del)
    out[i] = canon - acc
  }
  return out
}

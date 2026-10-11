// 校准模型（梯度提升树）推理：GOP 特征 → 0~2 分（贴近人工打分刻度）
// x = [af, 句内 af 均值, ...音素 one-hot(42)]
export function predict(model, x) {
  let y = model.baseline
  for (const nodes of model.trees) {
    let i = 0
    for (;;) {
      const [leaf, f, thr, missLeft, l, r, v] = nodes[i]
      if (leaf) { y += v; break }
      const xv = x[f]
      i = Number.isNaN(xv) ? (missLeft ? l : r) : xv <= thr ? l : r
    }
  }
  return y
}

/** 整句：gop 数组 + 音素 id 序列 → 每个音素的校准分 */
export function calibrate(model, gop, seq, V = 42) {
  const af = gop.map((g) => Math.max(-20, Math.min(0, g)))
  const mean = af.reduce((a, b) => a + b, 0) / af.length
  return af.map((a, k) => {
    const x = new Array(2 + V).fill(0)
    x[0] = a
    x[1] = mean
    x[2 + seq[k]] = 1
    return predict(model, x)
  })
}

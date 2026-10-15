// 拼写：听音 + 看意思写出单词。判对错、把写错的字母标出来（逐字对齐，像老师批改听写）

/** 适合拼的词：纯字母、3~14 个 */
export const canSpell = (w: string) => /^[a-z]{3,14}$/.test(w)

export type Mark = { c: string; k: 'ok' | 'wrong' | 'missing' | 'extra' }
export type SpellResult = 'right' | 'close' | 'wrong'

/** 编辑距离对齐：返回逐字标记（按正确答案的顺序，多写的字母也列出来） */
export function diffLetters(answer: string, given: string): Mark[] {
  const a = answer.toLowerCase(), g = given.toLowerCase().trim()
  const n = a.length, m = g.length
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === g[j - 1] ? 0 : 1))
  const out: Mark[] = []
  let i = n, j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === g[j - 1] ? 0 : 1)) { out.push({ c: a[i - 1], k: a[i - 1] === g[j - 1] ? 'ok' : 'wrong' }); i--; j-- }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { out.push({ c: a[i - 1], k: 'missing' }); i-- }
    else { out.push({ c: g[j - 1], k: 'extra' }); j-- }
  }
  return out.reverse()
}

/** 全对；长词（6 个字母以上）只错一个字母算“差一点”（手滑），其余算错 */
export function judgeSpell(answer: string, given: string): SpellResult {
  const g = given.toLowerCase().trim()
  if (g === answer.toLowerCase()) return 'right'
  const errs = diffLetters(answer, g).filter((x) => x.k !== 'ok').length
  return answer.length >= 6 && errs === 1 ? 'close' : 'wrong'
}

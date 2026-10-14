// 缩写词（doesn't、I'm、they'll…）：点词时照原样显示，并给出展开和意思；
// lookup 只会把它们还原成词根（doesn't → do），单看“做”会误解
export type Contraction = { full: string; zh: string }

const NOT: Record<string, Contraction> = {
  "don't": { full: 'do not', zh: '不（否定）' },
  "doesn't": { full: 'does not', zh: '不（否定，主语是他/她/它）' },
  "didn't": { full: 'did not', zh: '没有（过去的否定）' },
  "isn't": { full: 'is not', zh: '不是' },
  "aren't": { full: 'are not', zh: '不是' },
  "wasn't": { full: 'was not', zh: '（当时）不是' },
  "weren't": { full: 'were not', zh: '（当时）不是' },
  "haven't": { full: 'have not', zh: '还没有（已经…的否定）' },
  "hasn't": { full: 'has not', zh: '还没有（已经…的否定）' },
  "hadn't": { full: 'had not', zh: '（那时）还没有' },
  "won't": { full: 'will not', zh: '不会；不愿' },
  "wouldn't": { full: 'would not', zh: '不会；不愿' },
  "can't": { full: 'cannot', zh: '不能；不会' },
  "couldn't": { full: 'could not', zh: '不能；没能' },
  "shouldn't": { full: 'should not', zh: '不应该' },
  "mustn't": { full: 'must not', zh: '禁止；一定不要' },
  "needn't": { full: 'need not', zh: '不必' },
  "ain't": { full: 'am not / is not', zh: '不是（口语）' },
}
const SUFFIX: Record<string, [string, string]> = {
  "'m": ['am', ''], "'re": ['are', ''], "'ve": ['have', '已经…'], "'ll": ['will', '将会…'], "'d": ['would / had', '会…；已经…'],
}
const S_PRON = new Set(['it', 'he', 'she', 'that', 'there', 'here', 'what', 'who', 'where', 'how', 'when', 'why', 'let'])

export function contraction(token: string): Contraction | undefined {
  const t = token.toLowerCase().replace(/’/g, "'")
  if (NOT[t]) return NOT[t]
  if (t.endsWith("n't")) return { full: `${t.slice(0, -3)} not`, zh: '…不（否定）' }
  if (t === "let's") return { full: 'let us', zh: '我们…吧' }
  const m = t.match(/^([a-z]+)('[a-z]+)$/)
  if (!m) return undefined
  const [, head, suf] = m
  if (SUFFIX[suf]) return { full: `${head} ${SUFFIX[suf][0]}`, zh: SUFFIX[suf][1] }
  // 's 只有跟在代词/疑问词后才是 is/has；名词后的 's 是所有格（key's），照常查词
  if (suf === "'s" && S_PRON.has(head)) return { full: `${head} is / ${head} has`, zh: '' }
  return undefined
}

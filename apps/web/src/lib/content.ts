// 离线内容包：词表 + 例句（content/build_content.py 生成，随应用缓存）
import { normIpa } from './phones'
export type Word = { w: string; rank: number; cefr: string; ipa: string; zh: string; tags: string[]; cmu: string[]; sensitive: boolean }
/** 词表前 1.2 万是按常用程度排的；之后是补进来的考试大纲词（排名只是顺序，不代表常用程度） */
export const COMMON_WORDS = 12000
export const rankLabel = (w: Word) => w.rank <= COMMON_WORDS ? `第 ${w.rank.toLocaleString()} 常用` : '大纲补充词'

export type Sentence = { id: number; en: string; zh: string; hard: number; cefr: string; words: string[] }

let cache: Promise<{ words: Word[]; byWord: Map<string, Word>; sents: Sentence[]; sentsByWord: Map<string, Sentence[]> }> | null = null

export function loadContent() {
  if (!cache) {
    cache = (async () => {
      const [w, s] = await Promise.all([fetch('./content/words.json').then((r) => r.json()), fetch('./content/sentences.json').then((r) => r.json())])
      // 音标统一成现在的写法（词典里是 sei、'wɒ:tә 这种老式写法，见 phones.normIpa）
      const words: Word[] = w.map((x: any[]) => { const cmu = x[6] ? String(x[6]).split(' ') : []; return { w: x[0], rank: x[1], cefr: x[2], ipa: normIpa(x[3], cmu), zh: x[4], tags: x[5] ? String(x[5]).split(' ') : [], cmu, sensitive: x[7] === 1 } })
      const sents: Sentence[] = s.map((x: any[]) => ({ id: x[0], en: x[1], zh: x[2], hard: x[3], cefr: x[4], words: x[5] }))
      const byWord = new Map(words.map((x) => [x.w, x]))
      const sentsByWord = new Map<string, Sentence[]>()
      for (const st of sents) for (const t of st.words) {
        const a = sentsByWord.get(t)
        if (a) a.push(st)
        else sentsByWord.set(t, [st])
      }
      return { words, byWord, sents, sentsByWord }
    })()
  }
  return cache
}

/** 给一个词挑例句：优先句子里其他词都不比这个词难、长度适中的 */
export function pickSentence(sents: Sentence[] | undefined, rank: number, avoid = new Set<number>()): Sentence | undefined {
  if (!sents?.length) return undefined
  const ok = sents.filter((s) => !avoid.has(s.id))
  const pool = ok.length ? ok : sents
  return [...pool].sort((a, b) => Math.max(0, a.hard - rank) - Math.max(0, b.hard - rank) || Math.abs(a.en.length - 32) - Math.abs(b.en.length - 32))[0]
}

/** 点词查义：句子里的词形 → 词表词条（缩写拆开、常见词尾还原；查不到返回 undefined） */
export function lookup(byWord: Map<string, Word>, token: string): Word | undefined {
  let t = token.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z'-]/g, '')
  if (t.endsWith("n't")) t = t === "won't" ? 'will' : t === "can't" ? 'can' : t.slice(0, -3)
  else if (t.includes("'")) t = t.split("'")[0]
  if (t === 'i') return byWord.get('i')
  const tries = [t]
  if (t.endsWith('ies')) tries.push(t.slice(0, -3) + 'y')
  if (t.endsWith('es')) tries.push(t.slice(0, -2))
  if (t.endsWith('s')) tries.push(t.slice(0, -1))
  if (t.endsWith('ied')) tries.push(t.slice(0, -3) + 'y')
  if (t.endsWith('ed')) tries.push(t.slice(0, -2), t.slice(0, -1), t.slice(0, -3))
  if (t.endsWith('ing')) tries.push(t.slice(0, -3), t.slice(0, -3) + 'e', t.slice(0, -4))
  if (t.endsWith('ier')) tries.push(t.slice(0, -3) + 'y')
  if (t.endsWith('iest')) tries.push(t.slice(0, -4) + 'y')
  // bigger / biggest：去掉词尾和双写的辅音
  if (t.endsWith('er')) tries.push(t.slice(0, -2), t.slice(0, -1), t.slice(0, -3))
  if (t.endsWith('est')) tries.push(t.slice(0, -3), t.slice(0, -2), t.slice(0, -4))
  if (t.endsWith('ly')) tries.push(t.slice(0, -2))
  for (const x of tries) { const w = byWord.get(x); if (w) return w }
  return undefined
}

/** 按逗号拆开，括号里的逗号不拆（“拉塞尔（英国工程师, 整流器发明人）”是一个意思） */
function splitSenses(s: string): string[] {
  const out: string[] = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if ('(（['.includes(ch)) depth++
    else if (')）]'.includes(ch)) depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === '，') && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  out.push(cur.trim())
  return out.filter(Boolean)
}

/**
 * 学词卡上只放常用的意思：最多三种词性，第一种留三个意思、其余各留两个。
 * 词典原文一个词能列二三十个意思（turn 有 n./vt./vi. 共 30 多个），记的时候反而抓不住重点；词库详情页还是全部显示
 */
export function briefZh(zh: string): string {
  return zh.split(/[；;]/).map((g) => g.trim()).filter(Boolean).slice(0, 3).map((g, i) => {
    const m = g.match(/^([a-z]+\.)\s*([\s\S]*)$/i)
    const senses = splitSenses(m ? m[2] : g).slice(0, i === 0 ? 3 : 2)
    return (m ? `${m[1]} ` : '') + senses.join(', ')
  }).join('；')
}

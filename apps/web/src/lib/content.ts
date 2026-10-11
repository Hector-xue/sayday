// 离线内容包：词表 + 例句（content/build_content.py 生成，随应用缓存）
export type Word = { w: string; rank: number; cefr: string; ipa: string; zh: string; tags: string[]; cmu: string[]; sensitive: boolean }
export type Sentence = { id: number; en: string; zh: string; hard: number; cefr: string; words: string[] }

let cache: Promise<{ words: Word[]; byWord: Map<string, Word>; sents: Sentence[]; sentsByWord: Map<string, Sentence[]> }> | null = null

export function loadContent() {
  if (!cache) {
    cache = (async () => {
      const [w, s] = await Promise.all([fetch('./content/words.json').then((r) => r.json()), fetch('./content/sentences.json').then((r) => r.json())])
      const words: Word[] = w.map((x: any[]) => ({ w: x[0], rank: x[1], cefr: x[2], ipa: x[3], zh: x[4], tags: x[5] ? String(x[5]).split(' ') : [], cmu: x[6] ? String(x[6]).split(' ') : [], sensitive: x[7] === 1 }))
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

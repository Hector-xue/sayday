// 插件里不依赖浏览器的部分（node --test 能直接测）：查词（和 App 的 lookup 一样的还原规则）、取原句、拼同步快照

/** 词表：{ 词: [音标, 释义, 词频排名] } */
export function lookup(words, token) {
  let t = token.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z'-]/g, '')
  if (t.endsWith("n't")) t = t === "won't" ? 'will' : t === "can't" ? 'can' : t.slice(0, -3)
  else if (t.includes("'")) t = t.split("'")[0]
  const tries = [t]
  if (t.endsWith('ies')) tries.push(t.slice(0, -3) + 'y')
  if (t.endsWith('es')) tries.push(t.slice(0, -2))
  if (t.endsWith('s')) tries.push(t.slice(0, -1))
  if (t.endsWith('ied')) tries.push(t.slice(0, -3) + 'y')
  if (t.endsWith('ed')) tries.push(t.slice(0, -2), t.slice(0, -1), t.slice(0, -3))
  if (t.endsWith('ing')) tries.push(t.slice(0, -3), t.slice(0, -3) + 'e', t.slice(0, -4))
  if (t.endsWith('ier')) tries.push(t.slice(0, -3) + 'y')
  if (t.endsWith('iest')) tries.push(t.slice(0, -4) + 'y')
  if (t.endsWith('er')) tries.push(t.slice(0, -2), t.slice(0, -1), t.slice(0, -3))
  if (t.endsWith('est')) tries.push(t.slice(0, -3), t.slice(0, -2), t.slice(0, -4))
  if (t.endsWith('ly')) tries.push(t.slice(0, -2))
  for (const x of tries) if (words[x]) return { w: x, ipa: words[x][0], zh: words[x][1], rank: words[x][2] }
  return null
}

/** 选中的词所在的那句话：从文本里按句号 / 问号 / 感叹号切，太长就截 */
export function sentenceAround(text, offset) {
  const t = text.replace(/\s+/g, ' ')
  const before = t.slice(0, offset), after = t.slice(offset)
  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! '), before.lastIndexOf('\n'))
  const m = after.match(/[.?!](\s|$)/)
  let s = t.slice(start < 0 ? 0 : start + 2, m ? offset + m.index + 1 : t.length).trim()
  if (s.length > 240) { const i = offset - (start < 0 ? 0 : start + 2); s = (i > 120 ? '…' : '') + s.slice(Math.max(0, i - 120), i + 120).trim() + '…' }
  return s
}

/** 插件这台“设备”的同步快照：收的词作为新词卡（App 那边已有的不会被覆盖），原句放 kv 'clips' */
export function snapshotOf(dev, clips, now = Date.now()) {
  const card = Object.entries(clips).map(([word, c]) => ({ word, due: c.ts, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null, added: c.ts, known: 0 }))
  const kvClips = Object.fromEntries(Object.entries(clips).map(([w, c]) => [w, { s: c.s, url: c.url, title: c.title, ts: c.ts }]))
  return { v: 1, dev, ts: now, tables: { card }, kv: { clips: { v: JSON.stringify(kvClips), ts: now } } }
}

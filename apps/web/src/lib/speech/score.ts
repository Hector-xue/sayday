// 打分：音素后验 → 逐音素校准分 + 尾音检查 + 整句分（与网页演示、安卓 App 同一套 packages/speech）
import { prepare, afGop, tailLLR } from '@speech/gop.mjs'
import { calibrate, tailNote, tailPositions, uttScore, VOWELS } from '@speech/calib.mjs'
import type { Logits } from './engine'

export type WordResult = { word: string; phones: { p: string; s: number; level: 'g' | 'y' | 'r' }[]; tail: null | 'ins' | 'del'; level: 'g' | 'y' | 'r' }
export type ScoreResult = { score: number; words: WordResult[]; skipped: string[]; T: number }

let assets: Promise<{ dict: Record<string, string>; vocab: Record<string, number>; calib: any; phoneIds: number[] }> | null = null
export function speechAssets() {
  if (!assets) {
    assets = Promise.all(['./speech/cmudict.min.json', './speech/charsiu_vocab.json', './speech/calib.json'].map((u) => fetch(u).then((r) => r.json()))).then(([dict, vocab, calib]) => ({
      dict, vocab, calib, phoneIds: Object.entries(vocab as Record<string, number>).filter(([k]) => !k.startsWith('[')).map(([, id]) => id),
    }))
  }
  return assets
}

export const tokenize = (text: string) => (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).map((w) => w.toLowerCase())

export async function score(text: string, r: Logits): Promise<ScoreResult> {
  const { dict, vocab, calib, phoneIds } = await speechAssets()
  const all = tokenize(text)
  const known = all.filter((w) => dict[w]).map((w) => ({ word: w, phones: dict[w].split(' ') }))
  const skipped = all.filter((w) => !dict[w])
  const seq = known.flatMap((w) => w.phones).map((p) => vocab[p])
  const lp = prepare(r.logits, r.T, r.V)
  const scores: number[] = calibrate(calib, Array.from(afGop(lp, r.T, r.V, seq, phoneIds)), seq)
  const tp = tailPositions(known)
  const tails = tailLLR(lp, r.T, r.V, seq, tp.map((t: any) => t.at), VOWELS.map((p: string) => vocab[p]))
  const { red, yellow } = calib.thresholds
  const lv = (g: number) => (g < red ? 'r' : g < yellow ? 'y' : 'g') as 'g' | 'y' | 'r'
  const tailOf = new Map<object, 'ins' | 'del' | null>()
  tails.forEach((t: any, i: number) => tailOf.set(tp[i].word, tailNote(calib, t, tp[i], known)))
  let k = 0
  const words: WordResult[] = known.map((w) => {
    const phones = w.phones.map((p) => { const s = scores[k++]; return { p, s, level: lv(s) } })
    const tail = tailOf.get(w) ?? null
    const worst = phones.some((x) => x.level === 'r') ? 'r' : phones.some((x) => x.level === 'y') || tail === 'ins' ? 'y' : 'g'
    return { word: w.word, phones, tail, level: worst }
  })
  return { score: Math.round(uttScore(calib, scores, tails, known.length, r.T) * 10), words, skipped, T: r.T }
}

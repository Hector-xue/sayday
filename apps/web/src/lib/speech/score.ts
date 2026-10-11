// 打分：逻辑在 packages/speech/score.mjs（网页、安卓 App、MCP 工具共用），这里只负责载入词典 / 校准文件
import { scoreWith, phoneIdsOf, tokenize as tk, dictWord as dw } from '@speech/score.mjs'
import type { Logits } from './engine'

export type WordResult = { word: string; phones: { p: string; s: number; level: 'g' | 'y' | 'r' }[]; tail: null | 'ins' | 'del'; level: 'g' | 'y' | 'r' }
export type ScoreResult = { score: number; words: WordResult[]; skipped: string[]; T: number }
type Assets = { dict: Record<string, string>; vocab: Record<string, number>; calib: any; phoneIds: number[] }

let assets: Promise<Assets> | null = null
export function speechAssets(): Promise<Assets> {
  if (!assets) {
    assets = Promise.all(['./speech/cmudict.min.json', './speech/charsiu_vocab.json', './speech/calib.json'].map((u) => fetch(u).then((r) => r.json()))).then(([dict, vocab, calib]) => ({
      dict, vocab, calib, phoneIds: phoneIdsOf(vocab),
    }))
  }
  return assets
}

export const tokenize: (text: string) => string[] = tk
export const dictWord: (dict: Record<string, string>, w: string) => string | null = dw

export async function score(text: string, r: Logits): Promise<ScoreResult> {
  return scoreWith(await speechAssets(), text, r) as ScoreResult
}

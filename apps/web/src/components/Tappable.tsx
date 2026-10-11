// 点词查义：句子里每个词都能点，弹出本机词典的释义（不联网）
import { useEffect, useState } from 'react'
import { loadContent, lookup, type Word } from '../lib/content'
import { useApp } from '../store'
import { onPlayback } from '../lib/tts'

/** 每个词在整句里大约从几成开始读：按音节数估（标点处多留一点停顿），示范音频本身没有逐词时间 */
export function wordStarts(parts: string[]): number[] {
  const syl = (w: string) => Math.max(1, (w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g) || []).length)
  const weights: number[] = []
  for (let i = 1; i < parts.length; i += 2) weights.push(syl(parts[i]) + 0.6 + (/[,;:]/.test(parts[i + 1] ?? '') ? 1.2 : 0))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let acc = 0
  return weights.map((w) => { const s = acc / total; acc += w; return s })
}

export function Tappable({ text, highlight, karaoke }: { text: string; highlight?: string; karaoke?: boolean }) {
  const { toast } = useApp()
  const [byWord, setByWord] = useState<Map<string, Word> | null>(null)
  const [frac, setFrac] = useState<number | null>(null)
  useEffect(() => { loadContent().then((c) => setByWord(c.byWord)) }, [])
  useEffect(() => (karaoke ? onPlayback((p) => { if (p.text === text) setFrac(p.frac) }) : undefined), [karaoke, text])
  const parts = text.split(/([A-Za-z]+(?:'[A-Za-z]+)?)/)
  const starts = karaoke ? wordStarts(parts) : []
  const hl = highlight?.toLowerCase()
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p
        const isHl = !!hl && p.toLowerCase().startsWith(hl)
        const k = (i - 1) / 2
        const sung = frac !== null && starts[k] <= frac
        return (
          <span key={i} className={`tap ${isHl ? 'hl' : ''} ${frac !== null ? (sung ? 'sung' : 'unsung') : ''}`} onClick={() => {
            const w = byWord && lookup(byWord, p)
            toast(w ? `${w.w}  ${w.zh.split('；')[0]}` : `${p}：词典里没有`)
          }}>{p}</span>
        )
      })}
    </>
  )
}

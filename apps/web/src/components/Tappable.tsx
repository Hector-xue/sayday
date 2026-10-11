// 点词查义：句子里每个词都能点，弹出本机词典的释义（不联网）
import { useEffect, useState } from 'react'
import { loadContent, lookup, type Word } from '../lib/content'
import { useApp } from '../store'

export function Tappable({ text, highlight }: { text: string; highlight?: string }) {
  const { toast } = useApp()
  const [byWord, setByWord] = useState<Map<string, Word> | null>(null)
  useEffect(() => { loadContent().then((c) => setByWord(c.byWord)) }, [])
  const parts = text.split(/([A-Za-z]+(?:'[A-Za-z]+)?)/)
  const hl = highlight?.toLowerCase()
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p
        const isHl = !!hl && p.toLowerCase().startsWith(hl)
        return (
          <span key={i} className={`tap ${isHl ? 'hl' : ''}`} onClick={() => {
            const w = byWord && lookup(byWord, p)
            toast(w ? `${w.w}  ${w.zh.split('；')[0]}` : `${p}：词典里没有`)
          }}>{p}</span>
        )
      })}
    </>
  )
}

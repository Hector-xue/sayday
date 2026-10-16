// 拼写卡：自动读一遍这个词 + 显示中文意思，写出来提交；提交后逐字标出错在哪，给正确拼写和音标
import { useEffect, useRef, useState } from 'react'
import type { Word } from '../lib/content'
import { diffLetters, judgeSpell, type SpellResult } from '../lib/spell'
import { play, type Accent } from '../lib/tts'
import { PlayButton } from './PlayButton'
import { Explain, ask } from './Explain'

export function SpellCard({ word, accent, onResult }: { word: Word; accent: Accent; onResult: (r: SpellResult) => void }) {
  const [v, setV] = useState('')
  const [res, setRes] = useState<SpellResult | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    play({ text: word.w, word: word.w }, accent).catch(() => {})
    setTimeout(() => input.current?.focus(), 200)
  }, [word.w])
  const submit = () => {
    if (!v.trim() || res) return
    const r = judgeSpell(word.w, v)
    setRes(r)
    onResult(r)
  }
  return (
    <div className="spell fade-in">
      <div className="row"><p className="zh-mean" style={{ margin: 0 }}>{word.zh.split(/[；;]/).slice(0, 2).join('；')}</p><div className="spacer" /><PlayButton text={word.w} clip={{ text: word.w, word: word.w }} accent={accent} label="再听一遍" /></div>
      <p className="small muted">{word.w.length} 个字母</p>
      <input ref={input} className={`input spell-input ${res ?? ''}`} value={v} disabled={!!res} onChange={(e) => setV(e.target.value.replace(/[^a-zA-Z'-]/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} placeholder="听到的词写在这里" />
      {!res && <button className="btn primary block" disabled={!v.trim()} onClick={submit}>提交</button>}
      {res && (
        <div className="spell-res">
          <p className={`spell-verdict ${res === 'right' ? 'got-right' : 'got-wrong'}`}>{res === 'right' ? '拼对了' : res === 'close' ? '差一个字母' : '再记一下'}</p>
          {res !== 'right' && <p className="spell-diff en">{diffLetters(word.w, v).map((m, i) => <span key={i} className={m.k}>{m.c}</span>)}</p>}
          <p><b className="en spell-answer">{word.w}</b>{word.ipa && <span className="faint"> /{word.ipa}/</span>}</p>
          {res !== 'right' && <Explain prompt={() => ask.spell(word.w, word.zh, word.ipa, v)} />}
        </div>
      )}
    </div>
  )
}

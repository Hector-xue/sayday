// 点词查义的小卡片：贴着被点的词弹出（上方放得下就放上方，否则放下方），左右不出屏；
// 点卡片外面、滚动、换个词都会关。词、音标、释义、发音，没学过的能直接加入复习
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Word } from '../lib/content'
import { db } from '../lib/db'
import { addCard } from '../lib/srs'
import { FUNCTION_WORDS } from '../lib/lesson'
import { useApp } from '../store'
import { PlayButton } from './PlayButton'
import { contraction } from '../lib/contractions'

// 小三角伸出卡片 7px，GAP 要把它算进去，三角尖离词还留 11px
const GUTTER = 12, GAP = 18

export function WordPop({ anchor, word, token, onClose }: { anchor: HTMLElement; word?: Word; token: string; onClose: () => void }) {
  const { profile } = useApp()
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; below: boolean } | null>(null)
  const [have, setHave] = useState<boolean | null>(null)
  const short = contraction(token)
  const inflected = !!word && token.toLowerCase() !== word.w.toLowerCase()
  // 功能词（it、do、the…）不进词卡，不给“加入复习”
  useEffect(() => { if (word && !contraction(token) && !FUNCTION_WORDS.has(word.w)) db.one('SELECT word FROM card WHERE word = ?', [word.w]).then((r) => setHave(!!r)).catch(() => setHave(null)) }, [word, token])

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect(), b = box.current!.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const below = a.top - GAP - b.height < GUTTER + 40
    const center = a.left + a.width / 2
    const left = Math.min(Math.max(GUTTER, center - b.width / 2), vw - GUTTER - b.width)
    setPos({ left, top: below ? a.bottom + GAP : a.top - GAP - b.height, arrow: Math.min(Math.max(14, center - left), b.width - 14), below })
  }, [anchor, have])

  useEffect(() => {
    const out = (e: Event) => { if (!box.current?.contains(e.target as Node) && e.target !== anchor) onClose() }
    const close = () => onClose()
    document.addEventListener('pointerdown', out, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => { document.removeEventListener('pointerdown', out, true); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [anchor, onClose])

  return createPortal(
    <div ref={box} className={`word-pop ${pos?.below ? 'below' : 'above'}`} role="dialog" aria-label={word?.w ?? token}
      style={pos ? { left: pos.left, top: pos.top, ['--arrow' as string]: `${pos.arrow}px` } : { left: 0, top: 0, visibility: 'hidden' }}
      onClick={(e) => e.stopPropagation()}>
      {short ? (<>
        <div className="row">
          <div className="word-pop-head"><b className="en">{token}</b><span className="faint small"> = {short.full.replace(/^i\b/, 'I')}</span></div>
          <div className="spacer" />
          {profile && <PlayButton text={token} accent={profile.accent} />}
        </div>
        {short.zh && <p className="word-pop-zh">{short.zh}</p>}
      </>) : word ? (<>
        <div className="row">
          {/* 点的是变形（does、keys、went…）就照原样显示，后面注明原形，免得以为点错了词 */}
          <div className="word-pop-head">{inflected
            ? <><b className="en">{token}</b><span className="faint small"> 原形 <span className="en">{word.w}</span>{word.ipa && ` /${word.ipa}/`}</span></>
            : <><b className="en">{word.w}</b>{word.ipa && <span className="faint small"> /{word.ipa}/</span>}</>}</div>
          <div className="spacer" />
          {profile && (inflected ? <PlayButton text={token} accent={profile.accent} /> : <PlayButton text={word.w} clip={{ text: word.w, word: word.w }} accent={profile.accent} />)}
        </div>
        <p className="word-pop-zh">{word.zh.split('；').slice(0, 2).join('；')}</p>
        {have === false && <button className="btn small quiet" onClick={async () => { await addCard(word.w); setHave(true) }}>加入复习</button>}
        {have === true && <p className="small faint">已在复习里</p>}
      </>) : <p className="small muted"><b className="en">{token}</b>：词典里没有</p>}
    </div>,
    document.body,
  )
}

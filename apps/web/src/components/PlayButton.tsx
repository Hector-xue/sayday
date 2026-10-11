import { useState } from 'react'
import { Icon } from './icons'
import { play, stopAudio, type Accent, type Clip } from '../lib/tts'

/** 播放示范读音；第一次现场合成时显示“生成中” */
export function PlayButton({ text, clip, accent, rate = 1, label, onError }: { text: string; clip?: Clip; accent: Accent; rate?: number; label?: string; onError?: (e: Error) => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const click = async () => {
    if (state === 'playing') { stopAudio(); setState('idle'); return }
    setState('loading')
    try {
      const p = play(clip ?? text, accent, rate)
      setState('playing')
      await p
    } catch (e) {
      onError?.(e as Error)
    } finally {
      setState('idle')
    }
  }
  return (
    <button className={`icon-btn ${state === 'playing' ? 'playing' : ''}`} onClick={click} aria-label={label ?? '听示范'} title={label ?? '听示范'}>
      {state === 'loading' ? <span className="small">…</span> : state === 'playing' ? <Icon.stop /> : rate < 1 ? <Icon.slow /> : <Icon.play />}
    </button>
  )
}

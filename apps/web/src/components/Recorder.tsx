// 录音按钮：点一下开始、再点一下结束，交出 16kHz 音频（发音实验室用；跟读面板有自己的一套带打分的）
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { cancelRecording, ensureEngine, startRecording, stopRecording } from '../lib/speech/engine'

export function Recorder({ onAudio, disabled, hint }: { onAudio: (a: Float32Array) => Promise<void> | void; disabled?: boolean; hint?: string }) {
  const [phase, setPhase] = useState<'idle' | 'rec' | 'busy'>('idle')
  const [msg, setMsg] = useState('')
  const recRef = useRef(false)
  useEffect(() => { ensureEngine().catch(() => {}) }, [])
  useEffect(() => () => { if (recRef.current) cancelRecording() }, [])
  const toggle = async () => {
    if (phase === 'busy') return
    if (phase === 'idle') {
      try { await startRecording(); recRef.current = true; setPhase('rec'); setMsg('正在听…读完再点一下') } catch (e) { setMsg('用不了麦克风：' + ((e as Error).message || e)) }
      return
    }
    setPhase('busy'); setMsg('正在听你读的是哪个…')
    try {
      recRef.current = false
      const a = await stopRecording()
      if (a.length < 16000 * 0.3) { setMsg('太短了，没听清。再读一遍'); return }
      setMsg('')
      await onAudio(a)
    } catch (e) {
      setMsg('出错了：' + ((e as Error).message || e))
    } finally {
      setPhase('idle')
    }
  }
  return (
    <div className="rec-zone">
      <button className={`rec-btn ${phase === 'rec' ? 'on' : ''}`} onClick={toggle} disabled={disabled || phase === 'busy'} aria-label={phase === 'rec' ? '停止录音' : '开始录音'}>
        {phase === 'rec' ? <Icon.stop /> : <Icon.mic />}
      </button>
      <div className="rec-label">{msg || hint || '点一下开始读'}</div>
    </div>
  )
}

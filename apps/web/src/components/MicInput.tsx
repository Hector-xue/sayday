// 说话代替打字：点一下开始、再点一下结束 → 本机识别成文字（第一次要下载 63MB 识别模型，只下一次）
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { cancelRecording, startRecording, stopRecording } from '../lib/speech/engine'
import { ASR_MB, asrCached, asrStatus, ensureAsr, onAsrStatus, transcribe } from '../lib/speech/asr'
import { useApp } from '../store'

export function MicInput({ onText, disabled }: { onText: (t: string) => void; disabled?: boolean }) {
  const { toast } = useApp()
  const [phase, setPhase] = useState<'idle' | 'rec' | 'busy'>('idle')
  const [st, setSt] = useState(asrStatus())
  const rec = useRef(false)
  useEffect(() => onAsrStatus(setSt), [])
  useEffect(() => () => { if (rec.current) cancelRecording() }, [])

  const click = async () => {
    if (phase === 'busy') return
    if (phase === 'idle') {
      if (st.state !== 'ready' && !(await asrCached())) {
        if (!confirm(`说话输入要先下载一个约 ${ASR_MB}MB 的识别模型（只下一次，之后断网也能用，录音不上传）。现在下载？`)) return
      }
      ensureAsr().catch((e) => toast('识别模型载入失败：' + (e?.message || e)))
      try { await startRecording(); rec.current = true; setPhase('rec') } catch (e) { toast('用不了麦克风：' + ((e as Error).message || e)) }
      return
    }
    setPhase('busy')
    try {
      rec.current = false
      const audio = await stopRecording()
      if (audio.length < 16000 * 0.4) { toast('太短了，没听清'); return }
      const text = await transcribe(audio)
      if (!text) toast('没听出说了什么，靠近一点再说一次')
      else onText(text)
    } catch (e) {
      toast('识别失败：' + ((e as Error).message || e))
    } finally { setPhase('idle') }
  }
  const pct = st.state === 'loading' && st.total ? Math.round(((st.got ?? 0) / st.total) * 100) : null
  return (
    <button className={`mic-in ${phase}`} onClick={click} disabled={disabled} aria-label={phase === 'rec' ? '说完了' : '说话输入'} title="说话输入">
      {phase === 'rec' ? <Icon.stop /> : phase === 'busy' ? <span className="small">{pct !== null && pct < 100 ? `${pct}%` : '…'}</span> : <Icon.mic />}
    </button>
  )
}

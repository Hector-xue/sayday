// 动效小工具：录音音量、数字往上数。系统设了“减少动态效果”就直接给终值
import { useEffect, useState } from 'react'
import { recordLevel } from '../lib/speech/engine'

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** 录音时每 70ms 取一次音量，映射到 0~1 并做平滑；不在录时为 0 */
export function useMicLevel(active: boolean): number {
  const [lv, setLv] = useState(0)
  useEffect(() => {
    if (!active || reduced()) { setLv(0); return }
    let stop = false, cur = 0
    const tick = async () => {
      if (stop) return
      const target = Math.min(1, Math.sqrt(await recordLevel()) * 2.4)
      cur = target > cur ? cur * 0.4 + target * 0.6 : cur * 0.75 + target * 0.25
      if (!stop) setLv(cur)
      setTimeout(tick, 70)
    }
    tick()
    return () => { stop = true }
  }, [active])
  return lv
}

/** 数字从 0 数到 to（缓出），用于出分 */
export function useCountUp(to: number, ms = 700): number {
  const [v, setV] = useState(() => (reduced() ? to : 0))
  useEffect(() => {
    if (reduced()) { setV(to); return }
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [to, ms])
  return v
}

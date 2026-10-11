// 语调对比：示范（灰）和你（品牌色）的音高曲线叠在一起
import { useEffect, useState } from 'react'
import { getAudio, type Accent, type Clip } from '../lib/tts'
import { decodeTo16k } from '../lib/speech/engine'
import { advice, compare, contour, yin } from '../lib/pitch'

const refCache = new Map<string, (number | null)[]>()

async function refContour(clip: Clip, accent: Accent) {
  const k = accent + clip.text
  if (!refCache.has(k)) {
    const url = await getAudio(clip, accent)
    const buf = await (await fetch(url)).arrayBuffer()
    refCache.set(k, contour(yin(await decodeTo16k(buf))))
  }
  return refCache.get(k)!
}

function path(c: (number | null)[], W: number, H: number, lo: number, hi: number) {
  let d = '', pen = false
  c.forEach((v, i) => {
    if (v === null) { pen = false; return }
    const x = (i / (c.length - 1)) * W, y = H - ((v - lo) / (hi - lo || 1)) * H
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    pen = true
  })
  return d
}

export function Intonation({ clip, accent, audio }: { clip: Clip; accent: Accent; audio: Float32Array }) {
  const [data, setData] = useState<null | { ref: (number | null)[]; you: (number | null)[] }>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    setData(null)
    refContour(clip, accent).then((ref) => { if (live) setData({ ref, you: contour(yin(audio)) }) }).catch(() => live && setErr('示范音频没下载下来，语调对比要联网一次'))
    return () => { live = false }
  }, [clip.text, accent, audio])
  if (err) return <p className="small faint">{err}</p>
  if (!data) return <p className="small faint">正在画语调曲线…</p>
  if (data.you.length === 0 || data.ref.length === 0) return <p className="small faint">这次的录音太轻，画不出语调曲线</p>
  const all = [...data.ref, ...data.you].filter((v): v is number => v !== null)
  const lo = Math.min(-6, ...all), hi = Math.max(6, ...all)
  const W = 300, H = 90
  const c = compare(data.ref, data.you)
  return (
    <div className="intonation">
      <div className="row small"><b>语调</b><div className="spacer" /><span className="lg ref">示范</span><span className="lg you">你</span></div>
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} preserveAspectRatio="none" role="img" aria-label="语调曲线对比">
        <path d={path(data.ref, W, H, lo, hi)} className="ref" />
        <path d={path(data.you, W, H, lo, hi)} className="you" />
      </svg>
      {advice(c).map((t) => <p className="small muted" key={t}>{t}</p>)}
    </div>
  )
}

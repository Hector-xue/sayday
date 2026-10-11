// 跟读面板：听示范 → 录音 → 逐音标红黄绿 + 尾音提示 + 整句分 + 口型提示
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { PlayButton } from './PlayButton'
import { ensureEngine, engineStatus, onEngineStatus, infer, startRecording, stopRecording, cancelRecording, isNative } from '../lib/speech/engine'
import { score, type ScoreResult } from '../lib/speech/score'
import type { Accent } from '../lib/tts'

export const HINT: Record<string, string> = {
  TH: '舌尖轻放上下齿之间送气，不要发成 s / f', DH: '舌尖放齿间并振动声带，不要发成 d / z', V: '上齿轻咬下唇并振动，不要发成 w',
  W: '双唇收圆再展开，不要咬唇', R: '舌尖向后卷、不碰上颚，嘴唇略圆', L: '舌尖抵上齿龈，气流从舌两侧出', N: '舌尖抵上齿龈，气流从鼻腔出',
  IY: '长音 /iː/，嘴角向两边拉开并拉长', IH: '短音 /ɪ/，放松、短促', AE: '/æ/ 嘴张大、舌位低，介于“啊”和“诶”之间', NG: '舌后部抵软腭，不要加 g 的爆破',
  Z: '/z/ 要振动声带，不要发成 s', SH: '/ʃ/ 双唇前突，舌面抬高', S: '/s/ 舌尖靠近上齿龈，不要卷舌', UW: '长音 /uː/，双唇收圆前突', UH: '短音 /ʊ/，双唇微圆、放松',
  ER: '/ɜː/ 舌身后缩、卷舌，不要发成“饿”', AH: '/ʌ/ 嘴自然张开、短促，像轻声的“啊”', EY: '/eɪ/ 从“诶”滑向“衣”', OW: '/əʊ/ 从“呃”滑向“乌”', D: '舌尖抵上齿龈后弹开，词尾不要带出元音',
  T: '舌尖抵上齿龈后弹开，词尾不要带出元音', K: '舌后部抵软腭后放开，词尾轻收', JH: '/dʒ/ 舌尖贴上齿龈，双唇前突', CH: '/tʃ/ 舌尖贴上齿龈，双唇前突、送气',
}

export function ScoreView({ r }: { r: ScoreResult }) {
  const c = r.score >= 80 ? 'var(--good)' : r.score >= 60 ? 'var(--brand)' : 'var(--warn)'
  const bad = new Map<string, number>()
  for (const w of r.words) for (const p of w.phones) if (p.level !== 'g' && HINT[p.p]) bad.set(p.p, (bad.get(p.p) ?? 0) + (p.level === 'r' ? 2 : 1))
  const tips = [...bad.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const tails = r.words.filter((w) => w.tail === 'ins').length
  return (
    <div className="result fade-in">
      <div className="result-head">
        <div className="ring" style={{ ['--p' as string]: r.score / 100, ['--c' as string]: c }}><b>{r.score}</b></div>
        <div>
          <b>{r.score >= 85 ? '很好，就是这个感觉' : r.score >= 70 ? '不错，再练几个音' : r.score >= 50 ? '有进步空间，跟着示范再读一遍' : '先慢下来，一个词一个词跟'}</b>
          <p className="small muted">{tails ? `${tails} 个词尾多带了元音 · ` : ''}{r.words.filter((w) => w.level === 'r').length ? `${r.words.filter((w) => w.level === 'r').length} 个词要纠正` : '没有明显读错的词'}</p>
        </div>
      </div>
      <div className="words">
        {r.words.map((w, i) => (
          <div className="w" key={i}>
            <b>{w.word}</b>
            <span className="ps">{w.phones.map((p, j) => <span key={j} className={`p ${p.level}`}>{p.p.toLowerCase()}</span>)}</span>
            {w.tail === 'ins' && <span className="tail">/{w.phones[w.phones.length - 1].p.toLowerCase()}/ 后面多了个元音</span>}
            {w.tail === 'del' && <span className="tail">尾音可能没读出来</span>}
          </div>
        ))}
      </div>
      {tips.length > 0 && <ul className="tips">{tips.map(([p]) => <li key={p}><b>/{p.toLowerCase()}/</b>{HINT[p]}</li>)}</ul>}
      {r.skipped.length > 0 && <p className="small faint" style={{ marginTop: 10 }}>词典里没有的词没打分：{r.skipped.join('、')}</p>}
    </div>
  )
}

export function Shadow({ text, sentenceId, accent, onScored }: { text: string; sentenceId?: number; accent: Accent; onScored?: (r: ScoreResult) => void }) {
  const [phase, setPhase] = useState<'idle' | 'rec' | 'busy'>('idle')
  const [result, setResult] = useState<ScoreResult | null>(null)
  const [msg, setMsg] = useState('')
  const [eng, setEng] = useState(engineStatus())
  const recRef = useRef(false)
  useEffect(() => onEngineStatus(setEng), [])
  useEffect(() => { setResult(null); setMsg('') }, [text])
  // 只在离开页面（卸载）时丢掉还在录的音；不能挂在 phase 上，否则“录音中→打分中”时会先把录音掐掉
  useEffect(() => () => { if (recRef.current) cancelRecording() }, [])
  useEffect(() => { ensureEngine().catch(() => {}) }, [])

  const loadingModel = eng.state === 'loading'
  const toggle = async () => {
    if (phase === 'busy') return
    if (phase === 'idle') {
      try {
        await startRecording()
        recRef.current = true
        setPhase('rec')
        setMsg('正在听…读完再点一下')
      } catch (e) {
        setMsg('用不了麦克风：' + ((e as Error).message || e) + '。请在系统设置里允许日日说使用麦克风')
      }
      return
    }
    setPhase('busy')
    setMsg(loadingModel ? '模型还在下载，下完马上打分…' : '正在打分…')
    try {
      recRef.current = false
      const audio = await stopRecording()
      if (audio.length < 16000 * 0.4) { setMsg('太短了，没听清。点一下再读一遍'); setPhase('idle'); return }
      const lg = await infer(audio)
      const r = await score(text, lg)
      setResult(r)
      setMsg('')
      onScored?.(r)
    } catch (e) {
      setMsg('打分出错：' + ((e as Error).message || e))
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div>
      <div className="row" style={{ marginTop: 18 }}>
        <PlayButton text={text} clip={{ text, sentenceId }} accent={accent} label="听示范" onError={(e) => setMsg('示范读音生成失败：' + e.message)} />
        <PlayButton text={text} clip={{ text, sentenceId }} accent={accent} rate={0.75} label="慢速" onError={(e) => setMsg('示范读音生成失败：' + e.message)} />
        <span className="small muted">先听一遍，再跟着读</span>
      </div>
      <div className="rec-zone">
        <button className={`rec-btn ${phase === 'rec' ? 'on' : ''}`} onClick={toggle} disabled={phase === 'busy'} aria-label={phase === 'rec' ? '停止录音' : '开始跟读'}>
          {phase === 'rec' ? <Icon.stop /> : <Icon.mic />}
        </button>
        <div className="rec-label">
          {msg || (loadingModel && !isNative ? `首次使用要下载发音模型 ${eng.total ? Math.round(((eng.got ?? 0) / eng.total) * 100) + '%' : ''}（约 120MB，只下一次）` : eng.state === 'error' ? '发音模型载入失败：' + eng.error : result ? '再读一遍可以刷新分数' : '点一下开始跟读')}
        </div>
      </div>
      {result && <ScoreView r={result} />}
    </div>
  )
}

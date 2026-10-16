// 答错后“问 AI 为什么”：一键用用户自己的 AI 讲清楚错在哪（多邻国 Explain My Answer 的思路）。
// 没接 AI 时按钮还在，点了告诉去哪接（入口不藏起来）
import { useEffect, useRef, useState } from 'react'
import { complete, getAi, type AiConfig } from '../lib/ai'
import { useApp } from '../store'

const SYSTEM = '你是耐心的英语老师，学生的母语是中文。只用中文回答，直接讲重点，不客套，不用 markdown 标题和加粗符号。英文单词和句子保持原样。'

export function Explain({ prompt, label = '问 AI 为什么' }: { prompt: () => string; label?: string }) {
  const { toast } = useApp()
  const [ai, setAi] = useState<AiConfig | null | undefined>(undefined)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const stop = useRef<AbortController | null>(null)
  useEffect(() => { getAi().then(setAi).catch(() => setAi(null)); return () => stop.current?.abort() }, [])
  const go = async () => {
    if (!ai) { toast('先在 设置 → 你自己的 AI 里接入（DeepSeek 等都行），这里就能一键讲解'); return }
    setBusy(true); setErr(''); setText('')
    stop.current = new AbortController()
    try {
      await complete(ai, { system: SYSTEM, messages: [{ role: 'user', content: prompt() }], maxTokens: 500, temperature: 0.4, onDelta: setText, signal: stop.current.signal })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message || '没问到，再试一次')
    } finally { setBusy(false) }
  }
  if (ai === undefined) return null
  if (!text && !busy && !err) return <button className="btn small quiet explain-btn" onClick={go}>{label}</button>
  return (
    <div className="explain fade-in">
      <span className="small muted">AI 讲解</span>
      {text ? <p>{text}</p> : busy ? <p className="muted">正在想…</p> : null}
      {err && <><p className="small" style={{ color: 'var(--bad)' }}>{err}</p><button className="btn small quiet" onClick={go}>再试一次</button></>}
    </div>
  )
}

/** 各题型的提问（只给事实，让模型讲原因和记法） */
export const ask = {
  spell: (w: string, zh: string, ipa: string | undefined, typed: string) =>
    `听写单词：正确是 "${w}"${ipa ? `（/${ipa}/）` : ''}，意思：${zh}。我写成了 "${typed}"。\n请讲：我错在哪几个字母；这个词的发音和拼写是怎么对应的（或者词根词缀）；给一个好记的方法。120 字以内。`,
  listen: (en: string, zh: string, options: string[], answer: number, pick: number) =>
    `听力题：听一句英文，选它的中文意思。原句："${en}"（${zh}）。\n选项：${options.map((o, i) => `${'ABCD'[i]}. ${o}`).join('；')}。正确是 ${'ABCD'[answer]}，我选了 ${'ABCD'[pick]}。\n请讲：这句里哪些地方容易听错（连读、弱读、易混的词），我选的那个错在哪。120 字以内。`,
  practice: (kind: 'reading' | 'listening', q: string, mine: string, right: string, why: string, at: string) =>
    `雅思${kind === 'reading' ? '阅读' : '听力'}题：${q}\n我的答案：${mine || '（没答）'}；正确答案：${right}。\n参考解析：${why}\n原文依据："${at}"\n请讲：为什么是这个答案，我的答案错在哪，以后遇到这类题怎么判断。150 字以内。`,
}

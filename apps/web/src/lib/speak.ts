// 现编句子的朗读（AI 回复、日记）：App 走安卓系统 TTS（原生插件），网页走浏览器 speechSynthesis
// 例句和单词不走这里，用预生成的 Kokoro 音频包（音质好得多）
import { isNative } from './speech/engine'
import type { Accent } from './tts'

const tauri = (globalThis as any).__TAURI__?.core as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined
const LANG: Record<Accent, string> = { us: 'en-US', gb: 'en-GB' }

export const canSpeak = () => isNative || typeof speechSynthesis !== 'undefined'

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith('en'))
  // 同口音里优先“自然”“增强”类的声音
  const same = vs.filter((v) => v.lang.replace('_', '-') === lang)
  const good = (v: SpeechSynthesisVoice) => /natural|neural|enhanced|premium|google/i.test(v.name)
  return same.find(good) ?? same[0] ?? vs.find(good) ?? vs[0]
}

export async function speak(text: string, accent: Accent, rate = 0.95): Promise<void> {
  if (tauri) { await tauri.invoke('plugin:sayday-infer|speak', { text, lang: LANG[accent], rate }); return }
  if (typeof speechSynthesis === 'undefined') throw new Error('这个浏览器不支持朗读')
  speechSynthesis.cancel()
  // 部分浏览器首次 getVoices() 为空，等 voiceschanged
  if (!speechSynthesis.getVoices().length) await new Promise((r) => { speechSynthesis.onvoiceschanged = r; setTimeout(r, 800) })
  const u = new SpeechSynthesisUtterance(text)
  u.lang = LANG[accent]
  u.rate = rate
  const v = pickVoice(LANG[accent])
  if (v) u.voice = v
  await new Promise<void>((resolve, reject) => {
    u.onend = () => resolve()
    u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? resolve() : reject(new Error('朗读失败：' + e.error)))
    speechSynthesis.speak(u)
  })
}

export function stopSpeak() {
  if (tauri) { tauri.invoke('plugin:sayday-infer|speak_stop').catch(() => {}); return }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

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

export const speak = (text: string, accent: Accent, rate = 0.95): Promise<void> => speakLang(text, LANG[accent], rate)

/** 网页里有没有这种语言的系统语音（听学的中文讲解要用；声音列表还没载入时等一下） */
export async function hasVoice(lang: string): Promise<boolean> {
  if (isNative) return true
  if (typeof speechSynthesis === 'undefined') return false
  if (!speechSynthesis.getVoices().length) await new Promise((r) => { speechSynthesis.onvoiceschanged = r; setTimeout(r, 800) })
  const p = lang.split('-')[0]
  return speechSynthesis.getVoices().some((v) => v.lang.replace('_', '-').toLowerCase().startsWith(p))
}

function pickAnyVoice(lang: string): SpeechSynthesisVoice | undefined {
  if (lang.startsWith('en')) return pickVoice(lang)
  const p = lang.split('-')[0]
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(p))
  const good = (v: SpeechSynthesisVoice) => /natural|neural|enhanced|premium|google/i.test(v.name)
  // 中文优先普通话（zh-CN），不要粤语 / 台湾腔
  const main = vs.filter((v) => /^zh[-_]cn/i.test(v.lang) || v.lang.toLowerCase() === lang.toLowerCase())
  return main.find(good) ?? main[0] ?? vs.find(good) ?? vs[0]
}

/** 按语言朗读（lang：en-US / en-GB / zh-CN …） */
export async function speakLang(text: string, lang: string, rate = 0.95): Promise<void> {
  if (tauri) { await tauri.invoke('plugin:sayday-infer|speak', { text, lang, rate }); return }
  if (typeof speechSynthesis === 'undefined') throw new Error('这个浏览器不支持朗读')
  speechSynthesis.cancel()
  // 部分浏览器首次 getVoices() 为空，等 voiceschanged
  if (!speechSynthesis.getVoices().length) await new Promise((r) => { speechSynthesis.onvoiceschanged = r; setTimeout(r, 800) })
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  u.rate = rate
  const v = pickAnyVoice(lang)
  if (v) u.voice = v
  await new Promise<void>((resolve, reject) => {
    // 有的浏览器 / 没装语音的系统不触发 onend：按字数估一个上限，到点就当读完了（汉字一个字念得比一个字母久）
    const per = /[\u4e00-\u9fff]/.test(text) ? 320 : 120
    const guard = setTimeout(resolve, Math.max(4000, text.length * per / rate))
    u.onend = () => { clearTimeout(guard); resolve() }
    u.onerror = (e) => { clearTimeout(guard); if (e.error === 'interrupted' || e.error === 'canceled') resolve(); else reject(new Error('朗读失败：' + e.error)) }
    speechSynthesis.speak(u)
  })
}

export function stopSpeak() {
  if (tauri) { tauri.invoke('plugin:sayday-infer|speak_stop').catch(() => {}); return }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

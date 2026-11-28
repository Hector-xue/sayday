// 音标：词典（ECDICT）里的老式写法 → 现在课本用的写法；认不出时用 CMU 拼。网页（apps/web）和给 AI 助手的工具（packages/agent）共用
import { IPA } from './hints.mjs'

const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'])
const ipa = (p) => IPA[p] ?? p.toLowerCase()
/** 只用 CMU 拼出音标（词典没音标、或写法认不出时用）：没有重音标记；多音节里的 AH 读 /ə/、词尾 ER 读 /ə/、词尾 IY 读 /i/ */
export function ipaFromCmu(cmu) {
  const multi = cmu.filter((p) => VOWELS.has(p)).length > 1
  const last = cmu.length - 1
  return cmu.map((p, i) => multi && (p === 'AH' || (p === 'ER' && i === last)) ? 'ə' : multi && p === 'IY' && i === last ? 'i' : ipa(p)).join('')
}

const IPA_OK = /^[ˈˌabdefghijklmnprstuvwzæðŋθʃʒʌɑɒɔəɜɪʊːɡ]+$/

/**
 * 词典（ECDICT）里的音标是老式写法：sei、'wɒ:tә（西里尔字母 ә）、ɒ: 当 ɔː、i 当 ɪ，还常把几种读法写在一起。
 * 统一成现在课本用的写法（和“专项”页的音标表一致）：/seɪ/ /ˈwɔːtə/；只留第一种读法；
 * 认不出的（夹着 ^ \ ? 之类的坏字符）退回用 CMU 拼
 */
export function normIpa(raw, cmu = []) {
  // ^ 是 g 的乱码（i^'zæktli = exactly），\\: 是 ə: 的乱码
  let s = (raw ?? '').replace(/\u00a0/g, ' ').replace(/\^/g, 'g').replace(/\\+:/g, 'ә:').trim()
  // 只要第一种读法：“; ”“, ”“. ”分开的，“liv.laiv”这种中间的点，“'riәlaiz,'ri:-”这种带半截的
  s = s.split(/\s*;\s*|,\s+|\.\s+/)[0].split(/,(?=[^,]*-)/)[0]
  const dot = s.indexOf('.', 1)
  if (dot > 0) s = s.slice(0, dot)
  s = s.replace(/\([^)]*\)/g, '').trim()
  // 重音：' → ˈ；开头的 . 和 , → ˌ（次重音）
  s = s.replace(/'/g, 'ˈ').replace(/^[.,]/, 'ˌ').replace(/,/g, 'ˌ')
  const modern = /[ɪʊəɜ]/.test(s) && !/[әє]/.test(s)
  if (!modern) {
    s = s.replace(/ә/g, 'ə').replace(/[єεɛ]/g, 'e')
      .replace(/ə:/g, 'ɜː').replace(/[ɔɒ]i/g, 'ɔɪ').replace(/ɔ(?![:ɪ])/g, 'ɒ').replace(/[ɒɔ]:/g, 'ɔː')
      .replace(/i:/g, 'iː').replace(/u:/g, 'uː').replace(/[ɑa]:/g, 'ɑː')
      .replace(/əu|ou/g, 'əʊ').replace(/ei/g, 'eɪ').replace(/ai/g, 'aɪ').replace(/au|aj/g, 'aʊ')
      .replace(/iə/g, 'ɪə').replace(/uə/g, 'ʊə')
      // 词尾的 i 现在写 /i/（happy /ˈhæpi/），其余短 i 写 /ɪ/
      .replace(/i(?!ː|$)/g, 'ɪ').replace(/u(?!ː)/g, 'ʊ')
  }
  s = s.replace(/:/g, 'ː').replace(/ɡ/g, 'g')
  if (s && IPA_OK.test(s) && /[aeiouæʌɑɒɔəɜɪʊ]/.test(s)) return s
  return cmu.length ? ipaFromCmu(cmu) : ''
}

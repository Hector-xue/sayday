// 释义整理：词典写法 → 能念出来的中文（听学用）。
// 不依赖任何别的模块：content/audio/build_audio.mjs 在 CI 里直接 import 这个 .ts（Node 22 去类型运行），
// 用同一份代码算出每个词要念的中文、提前合成成音频包 zh/<zhKey>.mp3——两边算出来的字必须一模一样才对得上。
// 所以这里只能写 Node 能直接去掉类型跑的 TS：不用 enum / namespace / 参数属性，import 要带 .ts 后缀。

// ---------------- 释义：词典写法 → 能念出来的中文 ----------------

// ECDICT 的词性缩写（a. = 形容词）。及物 / 不及物都念“动词”：听的时候分得太细反而记不住
const POS: Record<string, string> = {
  n: '名词', a: '形容词', adj: '形容词', v: '动词', vt: '动词', vi: '动词', adv: '副词', pron: '代词', prep: '介词', conj: '连词',
  num: '数词', int: '感叹词', interj: '感叹词', art: '冠词', aux: '助动词', abbr: '缩写', pl: '复数', vbl: '动词',
}

export type GlossPart = { pos: string; senses: string[] }

/**
 * 词典释义整理成“词性 + 前几个意思”：去掉 [计] <法> (芭蕾舞用语) 这类标注，同一个词性（vt. / vi.）合并，
 * 最多 maxPos 个词性、每个最多 maxSense 个意思，意思加起来不超过 maxChars 个字（听的时候太长记不住）
 */
export function glossParts(zh: string, maxPos = 2, maxSense = 3, maxChars = 24): GlossPart[] {
  const clean = zh
    .replace(/\\[rn]|[\r\n]/g, '；')
    // 书名号的旧写法 <<启示录>>：留下书名（只去括号）
    .replace(/<<([^<>]*)>>|《([^》]*)》/g, (_, a, b) => a ?? b)
    .replace(/\[[^\]]*\]|<[^>]*>|\([^)]*\)|（[^）]*）|【[^】]*】/g, '')
    .replace(/[<>[\]()（）【】]/g, '')
    // 逗号后面紧跟词性的（“细读, vi. 细看”）也是另起一组
    .replace(new RegExp(`[,，]\\s*(?=(?:${Object.keys(POS).join('|')})\\.)`, 'gi'), '；')
  const parts: GlossPart[] = []
  let chars = 0
  // 分号后面没写词性的（“vt. 剽窃；偷偷地做；vi. 窃取”里的“偷偷地做”）接着算前一个词性
  let last = ''
  for (const group of clean.split(/[；;]/)) {
    // 开头的词性可能连着写好几个（“vt.vi.”“n.&a.”）：都吃掉，用第一个认识的
    let body = group
    let pos = ''
    let tagged = false
    for (;;) {
      const m = body.match(/^\s*([a-z]+)\.\s*(?:[&/和]\s*)?/i)
      if (!m || !Object.hasOwn(POS, m[1].toLowerCase())) break
      pos ||= POS[m[1].toLowerCase()]
      tagged = true
      body = body.slice(m[0].length)
    }
    if (!tagged) pos = last
    last = pos
    const senses = body.split(/[,，、/]/).map((s) => s.trim()).filter((s) => s && /[\u4e00-\u9fff]/.test(s))
    if (!senses.length) continue
    let part = parts.find((p) => p.pos === pos)
    if (!part) {
      if (parts.length >= maxPos) continue
      part = { pos, senses: [] }
      parts.push(part)
    }
    for (const s of senses) {
      if (part.senses.length >= maxSense || part.senses.includes(s)) continue
      // 第一个意思总要留；后面的超过字数就不要了
      if (chars > 0 && chars + s.length > maxChars) break
      part.senses.push(s)
      chars += s.length
    }
  }
  return parts.filter((p) => p.senses.length)
}

/** 念给你听的：“名词，市场。形容词，不同的，变化多的。” */
// 词典里的“测定...的时间”：省略号念出来不像话，换成“某事”
export const glossSpeech = (parts: GlossPart[]) => parts.map((p) => (p.pos ? `${p.pos}，` : '') + p.senses.join('，').replace(/\.{2,}|…+/g, '某事') + '。').join('')
/** 屏幕和锁屏上显示的：“n. 市场；a. 不同的，变化多的” 太长，只要意思 */
export const glossShort = (parts: GlossPart[]) => parts.map((p) => p.senses.join('，')).join('；')

/**
 * 一句中文在音频包里的文件名（zh/<键>.mp3）：按念的字算（cyrb53 哈希，36 进制），字一变就是另一个文件，
 * 不会念错成旧的。和 content/audio/build_audio.mjs 共用这一个函数
 */
export function zhKey(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * 中文讲解音频包（zh/<zhKey>.mp3）的版本：换了声音或语速（整套重新合成，文件名不变）就加 1。
 * 地址带上它，手机里缓存的旧音频就对不上了，不会新旧两种声音混着播。v2：换成更年轻的女声，语速加快
 */
export const ZH_VER = 2
export const zhPackPath = (key: string) => `zh/${key}.mp3?v=${ZH_VER}`

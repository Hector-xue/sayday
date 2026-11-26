import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
vi.mock('../db', () => ({ db: {}, kvGet: async () => null, kvSet: async () => {}, today: (d = new Date()) => { const x = new Date(d.getTime() - 4 * 3600_000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` } }))
vi.mock('../lesson', () => ({ previewWords: async () => [] }))
vi.mock('../srs', () => ({ dueWords: async () => [] }))
vi.mock('../tts', () => ({ PACK_PUBLIC: 'https://sayday.ivyea.com/audio/', getAudio: async () => '', NoAudio: class extends Error {} }))
vi.mock('../speak', () => ({ hasVoice: async () => true, speakLang: async () => {}, stopSpeak: () => {} }))
import { buildTrack, canSpellAloud, dayStart, estimateSec, glossParts, glossShort, glossSpeech, spellSeg, spellText } from '../listen'
import { nativeSeg } from '../listen-player'
import type { Word, Sentence } from '../content'

const W = (w: string, zh: string, ipa = ''): Word => ({ w, rank: 1000, cefr: 'B1', ipa, zh, tags: [], cmu: ['X'], sensitive: false })
const S: Sentence = { id: 1234, en: 'They abandoned the car in the snow.', zh: '他们把车丢在了雪地里。', hard: 900, cefr: 'B1', words: ['abandon'] }

describe('释义整理成能念的中文', () => {
  it('词性换成中文，vt. / vi. 合并成一个“动词”', () => {
    const p = glossParts('vi. 牛拉货车, 艰苦跋涉；n. 牛车旅行, 艰苦跋涉')
    expect(p).toEqual([{ pos: '动词', senses: ['牛拉货车', '艰苦跋涉'] }, { pos: '名词', senses: ['牛车旅行', '艰苦跋涉'] }])
    expect(glossSpeech(p)).toBe('动词，牛拉货车，艰苦跋涉。名词，牛车旅行，艰苦跋涉。')
    expect(glossShort(p)).toBe('牛拉货车，艰苦跋涉；牛车旅行，艰苦跋涉')
    const v = glossParts('vt. 剽窃；偷偷地做；偷窃；vi. 窃取；偷偷地行动；n. 偷窃；便宜货')
    expect(v.map((x) => x.pos)).toEqual(['动词', '名词'])
  })
  it('去掉 [计] <法> (用语) 这类标注和词典里的 \\r', () => {
    const p = glossParts('第一个字母 A; 一个; 第一的\\r；art. [计] 累加器, 加法器')
    const say = glossSpeech(p)
    expect(say).not.toMatch(/[[\]<>()\\]/)
    expect(say).toContain('第一个字母 A')
    expect(glossSpeech(glossParts('<法>n.(芭蕾舞用语)跳[字面意义：leap]'))).toBe('名词，跳。')
  })
  it('省略号念成“某事”', () => {
    expect(glossSpeech(glossParts('n. 时间；vt. 测定...的时间, 记录…的时间'))).toBe('名词，时间。动词，测定某事的时间，记录某事的时间。')
  })
  it('意思多的只留前几个，听得记得住', () => {
    const p = glossParts('n. 补充人员, 部下, 潜水艇, 胶层, 订户, 傻子；a. 附属的, 次级的；vt. 替代, 转包')
    expect(p.length).toBeLessThanOrEqual(2)
    expect(p[0].senses).toEqual(['补充人员', '部下', '潜水艇'])
  })
  it('整个词库：每个有中文释义的词都能念，念的内容没有残留标注、不太长', () => {
    const words: unknown[][] = JSON.parse(readFileSync(new URL('../../../../../content/pack/words.json', import.meta.url), 'utf8'))
    let empty = 0
    for (const x of words) {
      const zh = String(x[4] ?? '')
      if (!/[\u4e00-\u9fff]/.test(zh)) continue
      const parts = glossParts(zh)
      if (!parts.length) { empty++; continue }
      const say = glossSpeech(parts)
      expect(say, `${x[0]}: ${zh}`).not.toMatch(/[[\]<>()（）【】\\]|\b(vt|vi|adj|adv|n|a)\./)
      // 两个词性的前缀 + 最多 24 个字的意思 + 标点
      expect(say.length, `${x[0]}: ${say}`).toBeLessThanOrEqual(70)
    }
    // 有中文但整理完一个意思都不剩的：极少数（释义全在括号里），这些词就不念中文
    expect(empty).toBeLessThan(words.length * 0.002)
  })
})

describe('拼读', () => {
  it('整个词一段音频（音频包 p/），不是一个个字母拼', () => {
    expect(spellSeg('abandon')).toEqual({ t: 'audio', kind: 'p', key: 'abandon', text: 'A, B, A, N, D, O, N' })
  })
  it('系统语音顶替时念的：连字符念 hyphen、撇号不念、空格停一下', () => {
    expect(spellText('x-ray')).toBe('X, hyphen, R, A, Y')
    expect(spellText("o'clock")).toBe('O, C, L, O, C, K')
    expect(spellText('ice cream')).toBe('I, C, E. C, R, E, A, M')
  })
  it('单个字母的词、太长的、带怪字符的不拼', () => {
    expect(canSpellAloud('a')).toBe(false)
    expect(canSpellAloud('i')).toBe(false)
    expect(canSpellAloud('go')).toBe(true)
    expect(canSpellAloud('well-known')).toBe(true)
    expect(canSpellAloud("'")).toBe(false)
    expect(canSpellAloud('3d')).toBe(false)
    expect(canSpellAloud('a'.repeat(21))).toBe(false)
  })
})

describe('讲解脚本', () => {
  const w = W('abandon', 'vt. 放弃, 抛弃, 遗弃', 'ә\'bændәn')
  it('全开：读 → 拼 → 再读 → 中文 → 例句 → 译文 → 例句再读，最后留停顿', () => {
    const t = buildTrack(w, S, { spell: true, zh: true, example: true })
    const order = t.segs.filter((s) => s.t !== 'gap').map((s) => (s.t === 'say' ? `say:${s.lang}` : `${s.kind}`))
    expect(order).toEqual(['w', 'p', 'w', 'say:zh', 's', 'say:zh', 's'])
    expect(t.segs.at(-1)).toEqual({ t: 'gap', ms: 1500 })
    expect(t.gloss).toBe('放弃，抛弃，遗弃')
    expect(t.sentence?.id).toBe(1234)
    const zh = t.segs.filter((s) => s.t === 'say').map((s) => (s as { text: string }).text)
    expect(zh).toEqual(['动词，放弃，抛弃，遗弃。', S.zh])
  })
  it('关掉中文：没有中文段，例句读两遍；关掉拼写和例句：只读词', () => {
    const t = buildTrack(w, S, { spell: true, zh: false, example: true })
    expect(t.segs.some((s) => s.t === 'say' && s.lang === 'zh')).toBe(false)
    expect(t.segs.filter((s) => s.t === 'audio' && s.kind === 's').length).toBe(2)
    const only = buildTrack(w, S, { spell: false, zh: false, example: false })
    expect(only.segs.filter((s) => s.t !== 'gap')).toEqual([{ t: 'audio', kind: 'w', key: 'abandon', text: 'abandon' }])
  })
  it('没有例句、没有中文释义的词也能讲', () => {
    const t = buildTrack(W('blorp', ''), undefined, { spell: true, zh: true, example: true })
    expect(t.segs.some((s) => s.t === 'say')).toBe(false)
    expect(t.sentence).toBeUndefined()
  })
  it('估时：全开一个词十几秒，拼读按字母数', () => {
    expect(estimateSec({ word: 'go', ipa: '', gloss: '', segs: [spellSeg('go')] })).toBeCloseTo(0.9)
    const sec = estimateSec(buildTrack(w, S, { spell: true, zh: true, example: true }))
    expect(sec).toBeGreaterThan(10)
    expect(sec).toBeLessThan(30)
  })
})

describe('交给原生播放器的地址', () => {
  it('单词 / 拼读 / 例句都走公开音频包（单词名要转义），中文用 zh-CN', () => {
    expect(nativeSeg({ t: 'audio', kind: 'w', key: "o'clock", text: "o'clock" }, 'gb')).toEqual({ t: 'audio', url: "https://sayday.ivyea.com/audio/gb/w/o'clock.mp3", text: "o'clock", lang: 'en-GB' })
    expect(nativeSeg({ t: 'audio', kind: 'w', key: 'ice cream', text: 'ice cream' }, 'us')).toMatchObject({ url: 'https://sayday.ivyea.com/audio/us/w/ice%20cream.mp3' })
    expect(nativeSeg({ t: 'audio', kind: 's', key: '1234', text: 'x' }, 'us')).toMatchObject({ url: 'https://sayday.ivyea.com/audio/us/s/1234.mp3', lang: 'en-US' })
    expect(nativeSeg({ t: 'audio', kind: 'p', key: 'ice cream', text: 'I, C, E. C, R, E, A, M' }, 'gb')).toMatchObject({ url: 'https://sayday.ivyea.com/audio/gb/p/ice%20cream.mp3', lang: 'en-GB' })
    expect(nativeSeg({ t: 'say', lang: 'zh', text: '你好' }, 'us')).toEqual({ t: 'say', text: '你好', lang: 'zh-CN' })
    expect(nativeSeg({ t: 'gap', ms: 300 }, 'us')).toEqual({ t: 'gap', ms: 300 })
  })
})

describe('换日', () => {
  it('凌晨 4 点前算前一天', () => {
    expect(new Date(dayStart(new Date(2026, 10, 25, 2, 0))).getDate()).toBe(24)
    expect(new Date(dayStart(new Date(2026, 10, 25, 2, 0))).getHours()).toBe(4)
    expect(new Date(dayStart(new Date(2026, 10, 25, 9, 0))).getDate()).toBe(25)
  })
})

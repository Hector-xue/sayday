// v0.0.36：升 C2 差几个词、新词第一次复习排到明天、定级起点容一档手滑、音标统一、学词卡意思精简、听学和每日练习互通
import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: async () => null, kvSet: async () => {}, today: (d = new Date()) => { const x = new Date(d.getTime() - 4 * 3600_000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` } }))
import { vocabFloor } from '../levels'
import { BANDS, frontierFrom } from '../placement'
import { frontierOf } from '../calibrate'
import { normIpa, ipaFromCmu } from '../phones'
import { briefZh, type Word } from '../content'
import { mixHeard } from '../lesson'
import { pickCourse, WEAK_PER_GROUP, type HeardStat } from '../listen'
import { tomorrowStart } from '../srs'

describe('升下一档差几个词', () => {
  it('C1 的下一档 C2 从 8000 词起（以前算成 0）', () => {
    expect(vocabFloor('C2')).toBe(8000)
    expect(Math.max(0, vocabFloor('C2') - 5194)).toBe(2806)
  })
  it('其余档不变', () => {
    expect([vocabFloor('Pre-A1'), vocabFloor('A1'), vocabFloor('A2'), vocabFloor('B1'), vocabFloor('B2'), vocabFloor('C1')]).toEqual([0, 500, 1500, 2500, 3500, 5000])
  })
})

describe('学新词的起点', () => {
  it('最常用那档手滑点错两个（0.71），后面都认识：不拉回第 1 个词', () => {
    expect(frontierFrom([0.71, 0.95, 0.9, 0.85, 0.6, 0.3, 0, 0])).toBe(BANDS[4][0])
  })
  it('连着两档不到八成：从第一档开始', () => {
    expect(frontierFrom([0.7, 0.6, 0.9, 0.9, 0.9, 0, 0, 0])).toBe(1)
    expect(frontierFrom(BANDS.map(() => 0))).toBe(1)
  })
  it('最后一档单看自己；全认识 → 12000', () => {
    expect(frontierFrom([1, 1, 1, 1, 1, 1, 1, 0.5])).toBe(BANDS[7][0])
    expect(frontierFrom(BANDS.map(() => 1))).toBe(12000)
  })
  it('每周小测的水平用同一条规则', () => {
    expect(frontierOf([0.71, 0.95, 0.9, 0.85, 0.6, 0.3, 0, 0])).toBe(BANDS[4][0])
  })
})

describe('音标统一成现在的写法', () => {
  const cases: [string, string][] = [
    ['sei', 'seɪ'], ["'wɒ:tә", 'ˈwɔːtə'], [".infә'meiʃәn", 'ˌɪnfəˈmeɪʃən'], ['gou', 'gəʊ'], ['bɒi', 'bɔɪ'], ['bә:d', 'bɜːd'],
    ['ðєә', 'ðeə'], ["ai'diә", 'aɪˈdɪə'], ["'hæpi", 'ˈhæpi'], ['buk', 'bʊk'], ['ti:', 'tiː'],
    // 几种读法写在一起：只要第一种
    ["'minit. mai'nju:t", 'ˈmɪnɪt'], ['liv.laiv', 'lɪv'], ["di'rektli, dai'rektli", 'dɪˈrektli'], ["'riәlaiz,'ri:-", 'ˈrɪəlaɪz'],
    // 可省略的音去掉；乱码 ^ = g
    ["'frait(ә)nd", 'ˈfraɪtnd'], ["i^'zæktli", 'ɪgˈzæktli'],
    // 已经是新写法的只换重音和长音符号
    ["ˌpraɪvətaɪ'zeɪʃən", 'ˌpraɪvətaɪˈzeɪʃən'], ['ˈsi:sfaɪə(r)', 'ˈsiːsfaɪə'],
  ]
  for (const [raw, want] of cases) it(`${raw} → ${want}`, () => expect(normIpa(raw, ['X'])).toBe(want))
  it('认不出的退回 CMU；都没有就空', () => {
    expect(normIpa("simәl'teiniәsly; (?@) saim-", ['S', 'AY', 'M', 'AH', 'L', 'T', 'EY', 'N', 'IY', 'AH', 'S', 'L', 'IY'])).toBe('saɪməlteɪniːəsli')
    expect(normIpa('', ['S', 'EY'])).toBe('seɪ')
    expect(normIpa('nt', [])).toBe('')
  })
  it('CMU 拼的：多音节 AH → ə，词尾 IY → i', () => {
    expect(ipaFromCmu(['M', 'EH', 'N', 'IY'])).toBe('meni')
    expect(ipaFromCmu(['K', 'AH', 'T'])).toBe('kʌt')
  })
})

describe('学词卡上的意思只留常用的', () => {
  it('最多三种词性，第一种三个、其余两个', () => {
    expect(briefZh('vt. 说, 讲, 念, 说明, 指明；vi. 说, 讲；n. 意见, 发言权')).toBe('vt. 说, 讲, 念；vi. 说, 讲；n. 意见, 发言权')
    expect(briefZh('n. 转弯, 转动, 旋转, 翻转；vt. 使旋转, 转弯, 转动；vi. 转动, 转弯, 转向；a. 甲')).toBe('n. 转弯, 转动, 旋转；vt. 使旋转, 转弯；vi. 转动, 转弯')
  })
  it('括号里的逗号不拆；没有词性的也行', () => {
    expect(briefZh('n. 拉塞尔（英国工程师, 整流器发明人）, 姓氏')).toBe('n. 拉塞尔（英国工程师, 整流器发明人）, 姓氏')
    expect(briefZh('及其他, 等等')).toBe('及其他, 等等')
  })
})

describe('听学和每日练习互通', () => {
  const W = (w: string, rank: number): Word => ({ w, rank, cefr: 'B1', ipa: '', zh: '', tags: [], cmu: ['X'], sensitive: false })
  it('纯听学听熟了的词先学，最多占一半，常用的在前', () => {
    const order = [W('a', 3000), W('b', 3001), W('c', 3002), W('d', 3003), W('e', 3004)]
    const fam = [W('y', 900), W('x', 500), W('z', 1200), W('c', 3002)]
    expect(mixHeard(order, fam, 4).map((w) => w.w)).toEqual(['x', 'y', 'a', 'b'])
    expect(mixHeard(order, [], 3).map((w) => w.w)).toEqual(['a', 'b', 'c'])
    // 听熟的词本来就排在前面：不重复
    expect(mixHeard(order, [W('a', 3000)], 3).map((w) => w.w)).toEqual(['a', 'b', 'c'])
  })
  const since = 1_000_000
  const stats = new Map<string, HeardStat>([['r1', { days: 1, last: since - 10 }], ['r2', { days: 2, last: since - 20 }], ['today', { days: 1, last: since + 5 }]])
  const order = ['r1', 'r2', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']
  it('每组带上每日练习里记错的词（最多两个），排在复习之后、新词之前', () => {
    const out = pickCourse(order, stats, 6, since, new Set(), ['w1', 'w2', 'w3'])
    expect(WEAK_PER_GROUP).toBe(2)
    expect(out).toEqual(['r2', 'r1', 'w1', 'w2', 'n1', 'n2'])
  })
  it('今天听过的错词不再排；换一组时去掉的也不排；词表里的错词不重复', () => {
    expect(pickCourse(order, stats, 4, since, new Set(), ['today', 'w1'])).toEqual(['r2', 'r1', 'w1', 'n1'])
    expect(pickCourse(order, stats, 4, since, new Set(['w1']), ['w1', 'w2'])).toEqual(['r2', 'r1', 'w2', 'n1'])
    expect(pickCourse(order, stats, 5, since, new Set(), ['n1'])).toEqual(['r2', 'r1', 'n1', 'n2', 'n3'])
  })
  it('没有错词时和以前一样', () => {
    expect(pickCourse(order, stats, 4, since)).toEqual(['r2', 'r1', 'n1', 'n2'])
  })
})

describe('新词第一次复习排到明天', () => {
  it('凌晨 4 点换日：晚上 10 点学的 → 明早 4 点；凌晨 2 点学的（还算昨天）→ 今早 4 点', () => {
    expect(tomorrowStart(new Date(2026, 10, 27, 22, 0)).getTime()).toBe(new Date(2026, 10, 28, 4).getTime())
    expect(tomorrowStart(new Date(2026, 10, 28, 2, 0)).getTime()).toBe(new Date(2026, 10, 28, 4).getTime())
    expect(tomorrowStart(new Date(2026, 10, 30, 9, 0)).getTime()).toBe(new Date(2026, 11, 1, 4).getTime())
  })
})

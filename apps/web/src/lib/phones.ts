// CMU（ARPAbet）音素 → 国际音标（国内教材习惯的写法，英式长音带 ː）
export const IPA: Record<string, string> = {
  AA: 'ɑː', AE: 'æ', AH: 'ʌ', AO: 'ɔː', AW: 'aʊ', AY: 'aɪ', EH: 'e', ER: 'ɜː', EY: 'eɪ', IH: 'ɪ', IY: 'iː', OW: 'əʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'uː',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'g', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's', SH: 'ʃ',
  T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
}
export const ipa = (p: string) => IPA[p] ?? p.toLowerCase()
export const VOWEL_SET = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'])
/** 中国学习者的常见难点（方案 3.1），没有个人数据时先推荐这些 */
export const COMMON_HARD = ['TH', 'DH', 'V', 'R', 'L', 'N', 'IY', 'IH', 'AE', 'NG', 'Z']

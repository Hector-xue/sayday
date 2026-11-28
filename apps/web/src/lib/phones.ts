// CMU（ARPAbet）音素 → 国际音标（表在 packages/speech/hints.mjs，和 MCP 工具共用）
import { IPA as IPA_MAP } from '@speech/hints.mjs'
export const IPA: Record<string, string> = IPA_MAP
export const ipa = (p: string) => IPA[p] ?? p.toLowerCase()
export const VOWEL_SET = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'])
/** 中国学习者的常见难点（方案 3.1），没有个人数据时先推荐这些 */
export const COMMON_HARD = ['TH', 'DH', 'V', 'R', 'L', 'N', 'IY', 'IH', 'AE', 'NG', 'Z']

// 音标统一成现在的写法（网页和给 AI 助手的工具共用，见 packages/speech/ipa.mjs）
export { normIpa, ipaFromCmu } from '@speech/ipa.mjs'

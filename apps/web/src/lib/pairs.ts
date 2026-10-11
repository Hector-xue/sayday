// 最小对立词：中国学习者最容易混的几组音（方案 3.1）
// 每组的词都在词表和音频包里（scripts 核对过），听辨用音频包的单词读音
import { ctcLogLik, prepare } from '@speech/gop.mjs'
import { speechAssets } from './speech/score'
import type { Logits } from './speech/engine'

export type PairSet = { id: string; a: string; b: string; title: string; tip: string; pairs: [string, string][] }

export const PAIR_SETS: PairSet[] = [
  { id: 'iy-ih', a: 'IY', b: 'IH', title: '/iː/ 和 /ɪ/', tip: '长 /iː/ 嘴角往两边拉、拉长；短 /ɪ/ 放松、短促，不是“衣”', pairs: [['sheep', 'ship'], ['seat', 'sit'], ['leave', 'live'], ['feel', 'fill'], ['beat', 'bit'], ['heel', 'hill'], ['steal', 'still'], ['green', 'grin'], ['peach', 'pitch'], ['least', 'list']] },
  { id: 'th-s', a: 'TH', b: 'S', title: '/θ/ 和 /s/', tip: '/θ/ 舌尖放在上下齿之间送气；/s/ 舌尖在齿后', pairs: [['think', 'sink'], ['thick', 'sick'], ['mouth', 'mouse'], ['path', 'pass'], ['faith', 'face'], ['thumb', 'sum'], ['truth', 'truce'], ['theme', 'seem']] },
  { id: 'dh-d', a: 'DH', b: 'D', title: '/ð/ 和 /d/', tip: '/ð/ 舌尖在齿间、声带振动，气流不断；/d/ 是舌尖一弹', pairs: [['then', 'den'], ['they', 'day'], ['though', 'dough'], ['there', 'dare'], ['those', 'doze'], ['breathe', 'breed']] },
  { id: 'v-w', a: 'V', b: 'W', title: '/v/ 和 /w/', tip: '/v/ 上齿轻咬下唇；/w/ 嘴唇收圆，不碰牙齿', pairs: [['vest', 'west'], ['vine', 'wine'], ['veil', 'whale'], ['vet', 'wet'], ['vow', 'wow']] },
  { id: 'l-n', a: 'L', b: 'N', title: '/l/ 和 /n/', tip: '/l/ 气流从舌头两侧出；/n/ 气流从鼻子出（捏住鼻子 /n/ 发不出来）', pairs: [['light', 'night'], ['low', 'know'], ['lead', 'need'], ['line', 'nine'], ['lock', 'knock'], ['lap', 'nap'], ['load', 'node']] },
  { id: 'l-r', a: 'L', b: 'R', title: '/l/ 和 /r/', tip: '/l/ 舌尖顶上齿龈；/r/ 舌尖往后卷、不碰任何地方', pairs: [['light', 'right'], ['lead', 'read'], ['long', 'wrong'], ['glass', 'grass'], ['fly', 'fry'], ['collect', 'correct'], ['play', 'pray'], ['lane', 'rain'], ['cloud', 'crowd']] },
  { id: 's-sh', a: 'S', b: 'SH', title: '/s/ 和 /ʃ/', tip: '/s/ 嘴角平、舌尖在齿后；/ʃ/ 双唇前突，像“嘘”', pairs: [['sea', 'she'], ['sip', 'ship'], ['sort', 'short'], ['save', 'shave'], ['sell', 'shell'], ['seat', 'sheet'], ['mass', 'mash'], ['sock', 'shock']] },
  { id: 'n-ng', a: 'N', b: 'NG', title: '/n/ 和 /ŋ/', tip: '/n/ 舌尖顶上齿龈；/ŋ/ 舌根顶软腭，结尾不要带出 g', pairs: [['thin', 'thing'], ['win', 'wing'], ['ban', 'bang'], ['kin', 'king'], ['sin', 'sing'], ['ton', 'tongue']] },
  { id: 'ae-eh', a: 'AE', b: 'EH', title: '/æ/ 和 /e/', tip: '/æ/ 嘴张得更大、舌位更低；/e/ 嘴半开', pairs: [['bad', 'bed'], ['pan', 'pen'], ['bag', 'beg'], ['track', 'trek']] },
  { id: 't-d', a: 'T', b: 'D', title: '词尾 /t/ 和 /d/', tip: '词尾 /d/ 前面的元音读得更长、声带振动；/t/ 前面的元音短促', pairs: [['bet', 'bed'], ['seat', 'seed'], ['write', 'ride'], ['bat', 'bad'], ['neat', 'need'], ['white', 'wide']] },
]

/** 哪几组和某个音有关（弱项推荐） */
export const setsFor = (phone: string) => PAIR_SETS.filter((s) => s.a === phone || s.b === phone)

export type Judge = { said: 'target' | 'other' | 'unclear'; margin: number }

/**
 * 说的是哪个词：两个词的音素序列分别算 CTC 似然，按每帧平均的差值判断。
 * 不对称：偏向目标词就算对；明显偏向另一个词（差值 < -0.08）才判错，中间算“没听清”。
 * 阈值宁可偏宽容（方案第 10 节）。用 Kokoro 四种标准人声 × 69 对验证（552 次读对）：
 * 判对 91.7%、误判成另一个词 1.6%、没听清 6.7%；反过来真读错时能抓出约 59%。
 */
export async function judge(target: string, other: string, r: Logits, wrongTh = 0.08): Promise<Judge> {
  const { dict, vocab } = await speechAssets()
  const seq = (w: string) => dict[w].split(' ').map((p: string) => vocab[p])
  const lp = prepare(r.logits, r.T, r.V)
  const margin = (ctcLogLik(lp, r.T, r.V, seq(target)) - ctcLogLik(lp, r.T, r.V, seq(other))) / r.T
  return { said: margin > 0 ? 'target' : margin < -wrongTh ? 'other' : 'unclear', margin }
}

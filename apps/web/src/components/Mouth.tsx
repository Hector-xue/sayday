// 口型与舌位示意图（侧剖面，嘴在左）：舌头位置、嘴唇形状、气流走鼻腔还是口腔、声带振不振动
// 是示意，不是解剖图；配合文字提示一起看
type Pt = [number, number]
type Lips = 'rest' | 'spread' | 'round' | 'closed' | 'labiodental' | 'open'
type Cfg = { tip: Pt; blade?: Pt; hump: Pt; back: Pt; lips: Lips; nasal?: boolean; voiced?: boolean; jaw?: number; label: string }

const T = {
  rest: { tip: [52, 100], hump: [95, 90], back: [135, 112] },
  dental: { tip: [33, 88], blade: [50, 86], hump: [92, 92], back: [135, 114] },
  alveolar: { tip: [57, 75], blade: [64, 78], hump: [95, 88], back: [135, 112] },
  post: { tip: [62, 82], blade: [74, 72], hump: [100, 80], back: [136, 110] },
  retro: { tip: [72, 70], blade: [66, 84], hump: [102, 90], back: [136, 112] },
  velar: { tip: [54, 102], blade: [70, 96], hump: [124, 68], back: [140, 100] },
  hiFront: { tip: [50, 100], blade: [62, 84], hump: [84, 70], back: [134, 108] },
  midFront: { tip: [50, 101], blade: [64, 90], hump: [88, 80], back: [134, 110] },
  loFront: { tip: [50, 104], blade: [64, 98], hump: [90, 94], back: [136, 116] },
  central: { tip: [51, 102], blade: [66, 94], hump: [98, 86], back: [136, 112] },
  hiBack: { tip: [54, 104], blade: [70, 100], hump: [118, 72], back: [140, 104] },
  loBack: { tip: [54, 106], blade: [70, 104], hump: [112, 98], back: [140, 120] },
} as const satisfies Record<string, { tip: Pt; blade?: Pt; hump: Pt; back: Pt }>

const C = (t: keyof typeof T, lips: Lips, label: string, o: Partial<Cfg> = {}): Cfg => ({ ...T[t], lips, label, ...o })

export const MOUTH: Record<string, Cfg> = {
  TH: C('dental', 'open', '舌尖伸到上下齿之间，送气'),
  DH: C('dental', 'open', '舌尖在齿间，声带振动', { voiced: true }),
  S: C('alveolar', 'spread', '舌尖靠近上齿龈但不碰，气从缝里出', { tip: [55, 80] }),
  Z: C('alveolar', 'spread', '同 /s/，再加声带振动', { tip: [55, 80], voiced: true }),
  SH: C('post', 'round', '舌面抬高，双唇前突'),
  ZH: C('post', 'round', '同 /ʃ/，声带振动', { voiced: true }),
  CH: C('post', 'round', '舌尖先贴上齿龈再放开'),
  JH: C('post', 'round', '舌尖先贴上齿龈再放开，声带振动', { voiced: true }),
  T: C('alveolar', 'rest', '舌尖顶住上齿龈，再弹开'),
  D: C('alveolar', 'rest', '舌尖顶住上齿龈弹开，声带振动', { voiced: true }),
  N: C('alveolar', 'rest', '舌尖顶住上齿龈，气流走鼻子', { nasal: true, voiced: true }),
  L: C('alveolar', 'open', '舌尖顶上齿龈，气从舌头两侧出', { voiced: true }),
  R: C('retro', 'round', '舌尖往后卷，不碰上颚，嘴唇略圆', { voiced: true }),
  ER: C('retro', 'rest', '舌身后缩、舌尖卷起', { voiced: true }),
  K: C('velar', 'rest', '舌根顶住软腭，再放开'),
  G: C('velar', 'rest', '舌根顶住软腭放开，声带振动', { voiced: true }),
  NG: C('velar', 'rest', '舌根顶住软腭，气流走鼻子', { nasal: true, voiced: true, hump: [126, 66] }),
  F: C('rest', 'labiodental', '上齿轻咬下唇，送气'),
  V: C('rest', 'labiodental', '上齿轻咬下唇，声带振动', { voiced: true }),
  W: C('hiBack', 'round', '双唇收圆、突出，不碰牙齿', { voiced: true }),
  P: C('rest', 'closed', '双唇闭紧，再爆开'),
  B: C('rest', 'closed', '双唇闭紧爆开，声带振动', { voiced: true }),
  M: C('rest', 'closed', '双唇闭紧，气流走鼻子', { nasal: true, voiced: true }),
  IY: C('hiFront', 'spread', '舌前部抬高，嘴角向两边拉', { voiced: true }),
  IH: C('midFront', 'rest', '比 /iː/ 舌位低一点、放松', { voiced: true, hump: [86, 75] }),
  EY: C('midFront', 'spread', '从 /e/ 滑向 /ɪ/', { voiced: true }),
  EH: C('midFront', 'open', '舌前部半高，嘴半开', { voiced: true, jaw: 4 }),
  AE: C('loFront', 'open', '舌位低、嘴张大', { voiced: true, jaw: 10 }),
  AH: C('central', 'open', '舌头放平在中间，嘴自然张开', { voiced: true, jaw: 6 }),
  AA: C('loBack', 'open', '舌头放低靠后，嘴张大', { voiced: true, jaw: 12 }),
  AO: C('loBack', 'round', '舌位低靠后，双唇收圆', { voiced: true, jaw: 8 }),
  UW: C('hiBack', 'round', '舌后部抬高，双唇收圆前突', { voiced: true }),
  UH: C('hiBack', 'round', '比 /uː/ 放松、短', { voiced: true, hump: [116, 78] }),
  OW: C('central', 'round', '从 /ə/ 滑向 /ʊ/，嘴唇慢慢收圆', { voiced: true }),
  AW: C('loBack', 'open', '从 /a/ 滑向 /ʊ/', { voiced: true, jaw: 10 }),
  AY: C('loBack', 'open', '从 /a/ 滑向 /ɪ/', { voiced: true, jaw: 10 }),
  OY: C('loBack', 'round', '从 /ɔ/ 滑向 /ɪ/', { voiced: true, jaw: 6 }),
  HH: C('rest', 'open', '嘴张开直接呼气'),
  Y: C('hiFront', 'spread', '舌前部抬高贴近上颚，马上滑向后面的元音', { voiced: true }),
}

// Catmull-Rom → 三次贝塞尔，画平滑的舌头轮廓
function smooth(pts: Pt[], closed = false) {
  const p = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]]
  let d = `M${p[1][0]},${p[1][1]}`
  for (let i = 1; i < p.length - 2; i++) {
    const [a, b, c, e] = [p[i - 1], p[i], p[i + 1], p[i + 2]]
    d += `C${b[0] + (c[0] - a[0]) / 6},${b[1] + (c[1] - a[1]) / 6} ${c[0] - (e[0] - b[0]) / 6},${c[1] - (e[1] - b[1]) / 6} ${c[0]},${c[1]}`
  }
  return d + (closed ? 'Z' : '')
}

export function Mouth({ phone, size = 160 }: { phone: string; size?: number }) {
  const c = MOUTH[phone]
  if (!c) return null
  const jaw = c.jaw ?? 0
  const tip: Pt = [c.tip[0], c.tip[1] + (c.tip[1] > 95 ? jaw * 0.5 : 0)]
  const top: Pt[] = [[c.back[0], c.back[1] + jaw], [c.hump[0], c.hump[1] + jaw * 0.6], ...(c.blade ? [[c.blade[0], c.blade[1] + jaw * 0.4] as Pt] : []), tip]
  // 舌头 = 上表面（舌根 → 舌尖）+ 舌尖下面 + 口底，闭合成一块
  const tongue: Pt[] = [[136, 166], ...top, [Math.max(tip[0] + 12, 50), Math.max(tip[1] + 14, 110 + jaw)], [96, 128 + jaw]]
  // 嘴唇（外侧轮廓上）：上唇固定；下唇随口型、下巴动
  const lo = c.lips
  const upLipX = lo === 'round' ? 14 : 20
  const lowY = lo === 'closed' ? 83 : lo === 'labiodental' ? 86 : lo === 'round' ? 90 : lo === 'spread' ? 91 : 95 + jaw
  const lowX = lo === 'round' ? 14 : lo === 'labiodental' ? 30 : 20
  const velum = c.nasal ? 'M108,60 Q126,62 130,84' : 'M108,60 Q130,60 146,70'
  // 头部侧影（浅灰）+ 口腔（白）
  const face = `M70,0 C46,4 36,22 34,40 L14,60 Q10,66 18,68 L30,68 Q${upLipX + 2},70 ${upLipX},78 Q${upLipX},82 30,82 L30,${lowY} Q${lowX - 2},${lowY + 2} ${lowX},${lowY + 10} Q${lowX + 2},${lowY + 18} 30,${lowY + 22} Q28,${136 + jaw} 40,${146 + jaw} Q70,${156 + jaw} 104,150 L112,172 L170,172 L170,0 Z`
  const cavity = `M38,80 Q48,70 60,70 Q84,58 108,60 ${c.nasal ? 'Q126,62 130,84 L150,74' : 'Q130,60 146,70 L150,74'} L150,172 L136,172 ${top.map((p) => `L${p[0]},${p[1]}`).join(' ')} L36,${92 + jaw * 0.5} Z`
  return (
    <figure className="mouth" style={{ width: size }}>
      <svg viewBox="0 0 170 172" role="img" aria-label={`/${phone.toLowerCase()}/ 的口型舌位示意`}>
        <path d={face} className="m-face" />
        <path d="M18,62 Q60,46 150,52" className="m-line faint" />
        <path d={cavity} className="m-cavity" />
        {/* 硬腭 + 软腭 + 咽后壁 */}
        <path d="M38,80 Q48,70 60,70 Q84,58 108,60" className="m-line" />
        <path d={velum} className="m-line" />
        <path d="M150,60 Q156,110 150,172" className="m-line" />
        {/* 嘴唇 */}
        <path d={`M30,68 Q${upLipX + 2},70 ${upLipX},78 Q${upLipX},82 30,82 Z`} className="m-lip" />
        {lo === 'labiodental'
          ? <path d="M38,88 Q30,86 24,94 Q24,104 32,106 Z" className="m-lip" />
          : <path d={`M30,${lowY} Q${lowX - 2},${lowY + 2} ${lowX},${lowY + 10} Q${lowX + 2},${lowY + 18} 30,${lowY + 20} Z`} className="m-lip" />}
        {/* 牙齿 */}
        <path d="M33,78 L40,78 L39,90 L34,90Z" className="m-tooth" />
        <path d={`M34,${100 + jaw} L39,${100 + jaw} L40,${112 + jaw} L33,${112 + jaw}Z`} className="m-tooth" />
        {/* 舌头 */}
        <path d={smooth(tongue, true)} className="m-tongue" />
        {/* 气流 */}
        {c.nasal
          ? <path d="M144,128 Q148,80 128,58 L30,58" className="m-air" markerEnd="url(#m-arr)" />
          : <path d={`M144,150 Q146,${Math.min(c.hump[1], 80) - 6} 104,${Math.min(c.hump[1], 76) - 8} L${lo === 'closed' ? 40 : 26},${lo === 'closed' ? 86 : 88 + jaw / 2}`} className="m-air" markerEnd="url(#m-arr)" />}
        {c.voiced && <path d="M160,150 q5,-4 0,-8 q-5,-4 0,-8 q5,-4 0,-8 q-5,-4 0,-8" className="m-voice" />}
        <defs><marker id="m-arr" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L6,3L0,6Z" className="m-arrow" /></marker></defs>
      </svg>
      <figcaption className="small muted">{c.label}{c.label.includes('声带') ? '' : c.voiced ? ' · 声带振动' : ' · 声带不振动'}</figcaption>
    </figure>
  )
}

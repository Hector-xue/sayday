// 桌面小组件的预览图（“添加小部件”面板里那张）。国产桌面大多只认 previewImage，不认 previewLayout，
// 不给图就只显示 App 图标。照着 res/layout/sayday_w_*.xml 用网页画一遍（尺寸单位 1px = 1dp），浅色/深色各一套：
//   res/drawable-nodpi/sayday_preview_<种类>.png、res/drawable-night-nodpi/…
// 改了小组件布局或配色记得重跑：node apps/web/scripts/widget-previews.mjs
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const RES = join(ROOT, 'apps/native/src-tauri/plugins/sayday-infer/android/src/main/res')

/** 配色直接读小组件自己的 colors.xml，两边不会对不上 */
function colors(dir) {
  const xml = readFileSync(join(RES, dir, 'sayday_widget_colors.xml'), 'utf8')
  const c = {}
  for (const [, k, v] of xml.matchAll(/name="sayday_w_(\w+)">#([0-9A-Fa-f]{6,8})</g)) {
    // 安卓是 AARRGGBB
    c[k] = v.length === 8 ? `#${v.slice(2)}${v.slice(0, 2)}` : `#${v}`
  }
  return c
}

const CSS = (c) => `
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { background: transparent }
body { font-family: 'Noto Sans CJK SC', sans-serif; color: ${c.ink}; -webkit-font-smoothing: antialiased }
.w { background: ${c.bg}; border: 1px solid ${c.hair}; border-radius: 24px; padding: 16px; display: flex; flex-direction: column; overflow: hidden }
.row { display: flex; align-items: center }
.gap { flex: 1; min-height: 6px }
.sp { flex: 1 }
.chip { background: ${c.mark}; color: ${c.on_mark}; font-size: 12px; font-weight: 700; border-radius: 99px; padding: 2px 10px; line-height: 16px }
.faint { color: ${c.faint} } .soft { color: ${c.soft} }
.btn { height: 34px; border-radius: 99px; background: ${c.ink}; color: ${c.bg}; font-size: 14px; font-weight: 700; padding: 0 18px; display: flex; align-items: center }
.btn.soft { background: ${c.off}; color: ${c.ink}; font-size: 13px; padding: 0 16px }
.days { display: flex } .days > div { flex: 1; display: flex; flex-direction: column; align-items: center; font-size: 11px; color: ${c.faint} }
.dot { width: 30px; height: 30px; border-radius: 50%; margin-top: 4px; background: ${c.off}; display: flex; align-items: center; justify-content: center; color: ${c.on_mark}; font-size: 14px; font-weight: 700 }
.dot.on { background: ${c.mark} } .dot.today { border: 2px solid ${c.ink} }
.mark { background: ${c.mark}; color: ${c.on_mark}; border-radius: 4px; font-weight: 700 }
.serif { font-family: 'Noto Serif CJK SC', serif }
b { font-weight: 700 }
`

const dots = (states) => '<div class="days">' + '一二三四五六日'.split('').map((n, i) => `<div>${n}<span class="dot ${states[i]}">${states[i].includes('on') ? '✓' : ''}</span></div>`).join('') + '</div>'

/** 种类 → [宽 dp, 高 dp, 内容]。示例数据像真的在用的样子 */
const KINDS = {
  week: [320, 168, `<div class="w" style="width:320px;height:168px">
    <div class="row"><span class="chip">本周练了 3/4 天</span><span class="sp"></span><span class="faint" style="font-size:12px">连续 2 周</span></div>
    <div class="gap"></div>${dots(['on', 'on', '', 'on', 'today', '', ''])}<div class="gap"></div>
    <div class="row"><div class="sp"><b style="font-size:16px">今天还没练</b><div class="soft" style="font-size:12px;margin-top:1px">再练 1 天本周达标</div></div><span class="btn">开练</span></div></div>`],
  today: [160, 168, `<div class="w" style="width:160px;height:168px;padding:14px">
    <div class="row" style="align-items:baseline"><b style="font-size:40px;line-height:40px">3</b><b class="faint" style="font-size:16px;margin-left:2px">/4</b></div>
    <div class="soft" style="font-size:12px;margin-top:2px">本周练了几天</div><div class="gap"></div>
    <b style="font-size:14px">今天还没练</b><div class="row" style="margin-top:6px"><span class="btn">开练</span></div></div>`],
  word: [320, 168, `<div class="w" style="width:320px;height:168px">
    <div class="row"><span class="mark" style="font-size:24px;padding:0 6px;line-height:32px">resilient</span><span class="faint sp" style="font-size:13px;margin:0 8px">/rɪˈzɪliənt/</span><span class="btn soft">换一个</span></div>
    <b style="font-size:15px;margin-top:8px">adj. 有韧性的；能迅速恢复的</b><div class="gap"></div>
    <div class="serif" style="font-size:13px">Kids are surprisingly resilient.</div><div class="faint" style="font-size:12px;margin-top:2px">孩子们的恢复能力出奇地强。</div></div>`],
  episode: [320, 168, `<div class="w" style="width:320px;height:168px">
    <div class="row"><b class="soft sp" style="font-size:12px">第 3 集 · A2</b><span class="btn">去看</span></div><div class="gap"></div>
    <b class="serif" style="font-size:22px">First Day</b><div class="soft" style="font-size:13px;margin-top:4px">新公司第一天，你被安排坐在一个很爱开玩笑的同事旁边。</div></div>`],
  classic: [240, 168, `<div class="w" style="width:240px;height:168px;padding:14px">
    <div class="row"><span class="chip">本周练了 3/4 天</span></div><div class="gap"></div>
    <b style="font-size:17px">今天还没练</b><div class="soft" style="font-size:12px;margin-top:1px">累的话 2 分钟也算数</div><div class="gap"></div>
    <div class="row"><span class="mark" style="font-size:16px;padding:0 5px">resilient</span><span class="soft" style="font-size:12px;margin-left:8px">有韧性的</span></div></div>`],
  mini: [76, 76, `<div style="width:76px;height:76px;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <span class="dot on" style="width:50px;height:50px;margin:0;font-size:21px">练</span>
    <span style="font-size:11px;margin-top:3px;color:#fff;text-shadow:0 0 3px #0009">本周 3/4</span></div>`],
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] })
try {
  const page = await browser.newPage()
  for (const [dir, out] of [['values', 'drawable-nodpi'], ['values-night', 'drawable-night-nodpi']]) {
    const css = CSS(colors(dir))
    mkdirSync(join(RES, out), { recursive: true })
    for (const [kind, [w, h, html]] of Object.entries(KINDS)) {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 3 })
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style><body>${html}</body>`)
      await page.evaluate(() => document.fonts.ready)
      const file = join(RES, out, `sayday_preview_${kind}.png`)
      await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } })
      console.log(file.replace(ROOT + '/', ''))
    }
  }
} finally {
  await browser.close()
}

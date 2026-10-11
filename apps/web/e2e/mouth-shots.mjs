// 口型示意图逐个截图（改 Mouth.tsx 后人工看一遍）
// 用法: node e2e/mouth-shots.mjs <站点URL> <输出目录> [音标…]
import puppeteer from 'puppeteer-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const [BASE, OUT, ...want] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dir = mkdtempSync(join(OUT, 'chrome-mouth-'))
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
try {
  const p = await b.newPage()
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  const click = async (t, sel = 'button') => {
    await p.waitForFunction((t, sel) => [...document.querySelectorAll(sel)].some((x) => x.textContent.trim().startsWith(t)), { timeout: 60000 }, t, sel)
    await p.evaluate((t, sel) => [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().startsWith(t)).click(), t, sel)
    await sleep(200)
  }
  await p.goto(BASE, { waitUntil: 'networkidle0' })
  await click('开始'); await click('7.0'); await click('下一步'); await click('20 分钟'); await click('下一步')
  await click('跳过，我自己选水平'); await click('B1'); await click('确定'); await click('开始今天的练习')
  await click('发音', '.tab')
  for (const ph of want.length ? want : ['θ', 'r', 'l', 'iː', 'k', 'v', 'm', 'ɑː', 'ʃ', 'uː']) {
    await p.evaluate((ph) => [...document.querySelectorAll('.phone-chips button')].find((x) => x.textContent === ph).click(), ph)
    await sleep(300)
    const el = await p.$('.mouth')
    await el.screenshot({ path: join(OUT, `mouth-${ph}.png`) })
    await p.click('.session-top .icon-btn'); await sleep(200)
  }
} finally {
  await b.close()
  rmSync(dir, { recursive: true, force: true })
}

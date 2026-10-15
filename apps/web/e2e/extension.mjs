// 端到端：浏览器插件划词收词 → 同步 → App（另一台设备）里出现这个词，复习时带原句
// 用法: node e2e/extension.mjs <站点URL> <输出目录> <插件目录 dist/extension>
import puppeteer from 'puppeteer-core'
import http from 'node:http'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs'
import { join } from 'node:path'

const [BASE, OUT, EXT0] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('·', ...a)
const data = mkdtempSync(join(OUT, 'sync-data-'))
process.env.DATA_DIR = data; process.env.MIN_FREE_MB = '1'
const { handler } = await import('../../../packages/sync-server/server.mjs')
const srv = http.createServer(handler).listen(5395, '127.0.0.1')
const API = 'http://127.0.0.1:5395/api/sync'
// 插件里的同步地址换成本机的临时服务（再允许它访问本机）
const EXT = mkdtempSync(join(OUT, 'ext-'))
cpSync(EXT0, EXT, { recursive: true })
writeFileSync(join(EXT, 'background.js'), readFileSync(join(EXT, 'background.js'), 'utf8').replace("'https://sayday.ivyea.com/api/sync'", `'${API}'`))
const m = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8')); m.host_permissions.push('http://127.0.0.1/*'); writeFileSync(join(EXT, 'manifest.json'), JSON.stringify(m))
// 一个英文网页
const page = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<html><head><title>Morning news</title></head><body style="font-size:22px;padding:40px"><p id="t">The river flooded the old town. People were carrying their furniture upstairs all night.</p></body></html>') }).listen(5396, '127.0.0.1')
const dirs = []
// 带插件的那台用 Chrome for Testing（正式版 Chrome 137 起自动化里不让装未打包的插件）：环境变量 CFT 指到它
const launch = async (ext) => {
  const dir = mkdtempSync(join(OUT, 'chrome-ext-')); dirs.push(dir)
  const b = await puppeteer.launch({ executablePath: ext ? process.env.CFT : '/usr/bin/google-chrome', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', ...(ext ? [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] : [])] })
  if (ext) b.extId = new URL((await b.waitForTarget((t) => t.type() === 'service_worker', { timeout: 15000 })).url()).host
  return b
}
try {
  // 设备一：App（网页版），走完引导、开同步
  const app = await launch(null)
  const p = await app.newPage()
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  p.on('dialog', (d) => d.accept())
  await p.evaluateOnNewDocument((api) => { try { localStorage.setItem('sayday-sync-api', api) } catch {} }, API)
  await p.goto(BASE, { waitUntil: 'networkidle0' })
  const click = async (pg, t, sel = 'button') => { await pg.waitForFunction((t, sel) => [...document.querySelectorAll(sel)].some((x) => x.textContent.trim().startsWith(t) && !x.disabled), { timeout: 60000 }, t, sel); await pg.evaluate((t, sel) => [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().startsWith(t) && !x.disabled).click(), t, sel); await sleep(250) }
  await click(p, '开始'); await click(p, '7.0'); await click(p, '下一步'); await click(p, '20 分钟'); await click(p, '下一步'); await click(p, '开始测')
  await p.waitForSelector('.quiz-word', { timeout: 60000 })
  for (let k = 0; k < 200 && (await p.$('.quiz-word')); k++) await click(p, '不认识')
  await click(p, '开始今天的练习'); await p.waitForFunction(() => document.body.innerText.includes('今日练习'))
  await click(p, '今天', '.tab'); await p.click('[aria-label="设置"]'); await sleep(400)
  await click(p, '开启'); await p.waitForSelector('.sync-code-show', { timeout: 20000 })
  const code = await p.evaluate(() => document.querySelector('.sync-code-show').textContent)
  log('App 同步码', code)

  // 设备二：装了插件的浏览器，打开英文网页，双击 flooded
  const b = await launch(EXT)
  const extId = b.extId
  const w = await b.newPage()
  await w.goto('http://127.0.0.1:5396/', { waitUntil: 'load' })
  await sleep(800)
  const box = await w.evaluate(() => { const t = document.getElementById('t').firstChild; const i = t.textContent.indexOf('flooded'); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 7); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })
  await w.mouse.click(box.x, box.y, { clickCount: 2 })
  await sleep(1200)
  const card = await w.evaluate(() => { const h = [...document.documentElement.children].find((x) => x.shadowRoot); return h ? h.shadowRoot.querySelector('.c').innerText.replace(/\s+/g, ' ') : null })
  log('网页上弹的卡片', card)
  await w.screenshot({ path: join(OUT, 'ext-1-card.png') })
  await w.evaluate(() => [...document.documentElement.children].find((x) => x.shadowRoot).shadowRoot.querySelector('button').click())
  await sleep(500)
  // 插件弹窗：填同步码、同步
  const pop = await b.newPage()
  await pop.goto(`chrome-extension://${extId}/popup.html`)
  await pop.type('#code', code); await pop.click('#sync')
  await pop.waitForFunction(() => /同步好了|失败|不对|出错/.test(document.getElementById('st').textContent), { timeout: 20000 })
  log('插件弹窗', await pop.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')))
  await pop.setViewport({ width: 340, height: 520 }); await pop.screenshot({ path: join(OUT, 'ext-2-popup.png') })

  // 回到 App：立即同步 → 词库里有 flood，开一组复习能看到原句
  await click(p, '立即同步'); await p.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('同步好了'), { timeout: 20000 })
  await click(p, '词库', '.tab'); await sleep(600)
  log('App 词库', (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).match(/学习中 \d+/)?.[0])
  await click(p, '今天', '.tab'); await sleep(500); await click(p, '开始'); await sleep(1500)
  for (let k = 0; k < 12; k++) { if (await p.$('.seen-web')) break; const kind = await p.evaluate(() => document.querySelector('.session .step-kind')?.textContent ?? ''); if (kind.startsWith('复习')) break; await p.evaluate(() => [...document.querySelectorAll('.session-foot button')].find((x) => /记下了|下一/.test(x.textContent))?.click()); await sleep(400) }
  log('复习时', await p.evaluate(() => (document.querySelector('.seen-web')?.innerText ?? document.querySelector('.session .step-kind')?.textContent ?? '').replace(/\s+/g, ' ')))
  await p.screenshot({ path: join(OUT, 'ext-3-review.png') })
  await app.close(); await b.close()
} finally {
  srv.close(); page.close()
  for (const d of [data, EXT, ...dirs]) rmSync(d, { recursive: true, force: true })
}

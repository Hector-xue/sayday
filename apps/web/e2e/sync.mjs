// 端到端：两台设备用同步码同步（本机临时起一个同步服务，不碰线上）+ 学习搭子小组
// 用法: node e2e/sync.mjs <站点URL> <输出目录>
//   站点用 spikes/m0/serve.py --dir apps/web/dist 起在 127.0.0.1
import puppeteer from 'puppeteer-core'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const [BASE, OUT] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('·', ...a)

const data = mkdtempSync(join(OUT, 'sync-data-'))
process.env.DATA_DIR = data
process.env.MIN_FREE_MB = '1'
const { handler } = await import('../../../packages/sync-server/server.mjs')
const srv = http.createServer(handler).listen(5395, '127.0.0.1')
const API = 'http://127.0.0.1:5395/api/sync'

const dirs = []
async function device(name) {
  const dir = mkdtempSync(join(OUT, `chrome-sync-${name}-`))
  dirs.push(dir)
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
  const p = await b.newPage()
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  p.on('dialog', (d) => d.accept())
  const errors = []
  p.on('pageerror', (e) => errors.push(`${name} pageerror ${e.message}`))
  await p.evaluateOnNewDocument((api) => { try { localStorage.setItem('sayday-sync-api', api) } catch {} }, API)
  await p.goto(BASE, { waitUntil: 'networkidle0' })
  const clickText = async (t, sel = 'button') => {
    await p.waitForFunction((t, sel) => [...document.querySelectorAll(sel)].some((x) => x.textContent.trim().startsWith(t) && !x.disabled), { timeout: 60000 }, t, sel)
    await p.evaluate((t, sel) => [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().startsWith(t) && !x.disabled).click(), t, sel)
    await sleep(250)
  }
  const text = () => p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
  const shot = (n) => p.screenshot({ path: join(OUT, `sync-${name}-${n}.png`) })
  const settings = async () => { await clickText('今天', '.tab'); await p.waitForSelector('[aria-label="设置"]'); await p.click('[aria-label="设置"]'); await sleep(400) }
  return { b, p, errors, clickText, text, shot, settings }
}

try {
  // 设备 A：新用户，定级时全部“不认识”，走完引导
  const A = await device('a')
  await A.clickText('开始'); await A.clickText('7.0'); await A.clickText('下一步'); await A.clickText('20 分钟'); await A.clickText('下一步'); await A.clickText('开始测')
  await A.p.waitForSelector('.quiz-word', { timeout: 60000 })
  for (let k = 0; k < 200 && (await A.p.$('.quiz-word')); k++) await A.clickText('不认识')
  await A.clickText('开始今天的练习')
  await A.p.waitForFunction(() => document.body.innerText.includes('今日练习'))
  log('A 引导完', (await A.text()).match(/离目标.{0,40}/)?.[0])
  // A：选兴趣、开同步，拿到同步码
  await A.settings()
  await A.clickText('美食', '.chip')
  await A.clickText('开启'); await A.p.waitForSelector('.sync-code-show', { timeout: 20000 })
  const code = await A.p.evaluate(() => document.querySelector('.sync-code-show').textContent)
  log('A 同步码', code)
  await A.shot('settings')

  // 设备 B：欢迎页直接用同步码接上
  const B = await device('b')
  await B.clickText('在别的设备上用过')
  await B.p.type('.sync-code', code.toLowerCase().replace(/-/g, ' '))
  await B.clickText('接上')
  await B.p.waitForFunction(() => document.body.innerText.includes('今日练习'), { timeout: 30000 })
  log('B 接上后', (await B.text()).match(/离目标.{0,40}/)?.[0])
  await B.settings()
  log('B 的兴趣（应该是 A 选的）', await B.p.evaluate(() => [...document.querySelectorAll('.chip[aria-pressed="true"]')].map((x) => x.textContent).join('、')))
  log('B 同步状态', await B.p.evaluate(() => [...document.querySelectorAll('.set-row')].find((x) => x.textContent.includes('多设备同步'))?.innerText.replace(/\s+/g, ' ')))
  // B 改兴趣 → 同步；A 同步后能看到
  await B.clickText('旅行', '.chip'); await sleep(300)
  await B.clickText('立即同步'); await B.p.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('同步好了'), { timeout: 20000 })
  await A.clickText('立即同步'); await A.p.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('同步好了'), { timeout: 20000 })
  await A.clickText('进步', '.tab'); await A.settings()
  log('A 同步回来的兴趣', await A.p.evaluate(() => [...document.querySelectorAll('.chip[aria-pressed="true"]')].map((x) => x.textContent).join('、')))
  log('A 同步状态', await A.p.evaluate(() => [...document.querySelectorAll('.set-row')].find((x) => x.textContent.includes('多设备同步'))?.innerText.replace(/\s+/g, ' ')))

  // 学习搭子：A 建小组，B 用小组码加入，两边都看到两个人
  await A.clickText('进步', '.tab'); await sleep(500)
  await A.clickText('建一个小组'); await A.p.type('.buddy-form .input', '小A'); await A.clickText('建小组')
  await A.p.waitForSelector('.buddy-list li', { timeout: 15000 })
  const gcode = await A.p.evaluate(() => document.querySelector('.buddy .en').textContent)
  await B.clickText('进步', '.tab'); await sleep(500)
  await B.clickText('我有小组码'); await B.p.type('.buddy-form .input', '小B'); await B.p.type('.buddy-form .sync-code', gcode); await B.clickText('加入')
  await B.p.waitForFunction(() => document.querySelectorAll('.buddy-list li').length >= 2, { timeout: 15000 })
  await B.p.evaluate(() => document.querySelector('.buddy')?.scrollIntoView({ block: 'center' })); await sleep(300); await B.shot('buddy')
  log('B 看到的小组', await B.p.evaluate(() => document.querySelector('.buddy-list').innerText.replace(/\s+/g, ' ')))
  // 服务器上只有密文
  const files = await (await fetch(`${API}/v1/a/${'0'.repeat(40)}`)).json()
  log('服务器上随便一个账号', JSON.stringify(files))
  log('错误', JSON.stringify([...A.errors, ...B.errors]))
  await A.b.close(); await B.b.close()
} finally {
  srv.close()
  for (const d of [data, ...dirs]) rmSync(d, { recursive: true, force: true })
}

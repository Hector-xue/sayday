// 端到端：新用户第一天。headless Chrome + 假麦克风（--use-file-for-fake-audio-capture）
// 用法: node e2e/first-day.mjs <站点URL> <输出目录> [假麦克风wav]
//   站点用 spikes/m0/serve.py --dir apps/web/dist 起在 127.0.0.1；断网测试会直接停掉服务器进程（SERVER_PID）
//   测线上：PW=<内测密码> node e2e/first-day.mjs https://sayday.ivyea.com/app/ <输出目录> [wav]
import puppeteer from 'puppeteer-core'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [BASE, OUT, WAV] = process.argv.slice(2)
const root = new URL('../../../', import.meta.url).pathname
const words = JSON.parse(readFileSync(join(root, 'content/pack/words.json')))
const pseudo = new Set(JSON.parse(readFileSync(join(root, 'content/pack/pseudo.json'))))
const rank = new Map(words.map((w) => [w[0], w[1]]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('·', ...a)

const dir = mkdtempSync(join(OUT, 'chrome-e2e-'))
const args = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
if (WAV) args.push(`--use-file-for-fake-audio-capture=${WAV}`)
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, userDataDir: dir, args, protocolTimeout: 900000 })
const errors = []
try {
  const p = await b.newPage()
  if (process.env.PW) await p.authenticate({ username: 'sayday', password: process.env.PW })
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message))
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console ' + m.text().slice(0, 200)) })
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const shot = (n) => p.screenshot({ path: join(OUT, `e2e-${n}.png`) })
  const clickText = async (t, sel = 'button') => {
    await p.waitForFunction((t, sel) => [...document.querySelectorAll(sel)].some((b) => b.textContent.trim().startsWith(t) && !b.disabled), { timeout: 600000 }, t, sel)
    await p.evaluate((t, sel) => [...document.querySelectorAll(sel)].find((b) => b.textContent.trim().startsWith(t) && !b.disabled).click(), t, sel)
    await sleep(250)
  }
  const text = () => p.evaluate(() => document.body.innerText)

  await p.goto(BASE, { waitUntil: 'networkidle0' })
  await shot('01-welcome')
  await clickText('开始')
  await clickText('7.0')
  await shot('02-goal')
  await clickText('下一步')
  await clickText('20 分钟')
  await clickText('下一步')
  await clickText('开始测')
  // 定级：模拟“认识前 2000 个词”的学习者；假词一律不认识
  let n = 0
  for (;;) {
    const w = await p.evaluate(() => document.querySelector('.quiz-word')?.textContent)
    if (!w) break
    const yes = !pseudo.has(w) && (rank.get(w) ?? 99999) <= 2000
    if (n === 10) await shot('03-quiz')
    await clickText(yes ? '认识' : '不认识')
    n++
    if (n > 200) throw new Error('定级没结束')
  }
  await p.waitForFunction(() => document.body.innerText.includes('你的起点'))
  const report = await text()
  log('定级答题', n, '个 →', report.match(/你的起点\s+(\S+)/)?.[1], report.match(/约 [\d,]+ 词/)?.[0])
  await shot('04-report')
  await clickText('开始今天的练习')
  await p.waitForFunction(() => document.body.innerText.includes('今日练习'))
  await sleep(500)
  await shot('05-today')
  log('今天页', (await text()).match(/新词[\s\S]*?\d+\/\d+/)?.[0].replace(/\s+/g, ' '))

  // 第一组：没有到期复习 → 新词 8 个 → 跟读 3 句
  await clickText('开始')
  await p.waitForSelector('.session .step-kind')
  let learned = 0, known = 0, shadows = 0, reviews = 0
  for (let guard = 0; guard < 80; guard++) {
    const kind = await p.evaluate(() => document.querySelector('.session .step-kind')?.textContent ?? '')
    if (!kind) break
    if (kind.startsWith('新词')) {
      if (learned === 0) await shot('06-learn')
      if (learned + known === 2) { await clickText('早就认识'); known++ } else { await clickText('记下了'); learned++ }
    } else if (kind.startsWith('复习')) {
      await clickText('看答案'); await clickText('记得'); reviews++
    } else if (kind.startsWith('跟读')) {
      await p.click('.rec-btn'); await sleep(3500); await p.click('.rec-btn')
      await p.waitForFunction(() => document.querySelector('.ring b') || /出错|没听清|用不了/.test(document.querySelector('.rec-label')?.textContent ?? ''), { timeout: 600000 })
      const res = await p.evaluate(() => ({ score: document.querySelector('.ring b')?.textContent, label: document.querySelector('.rec-label')?.textContent, sentence: document.querySelector('.shadow-sentence')?.textContent }))
      log('跟读', JSON.stringify(res))
      if (shadows === 0) await shot('07-shadow')
      shadows++
      if (!res.score) { await clickText('跳过'); continue }
      await clickText('下一句')
    }
  }
  await p.waitForFunction(() => /这一组完成了|今天的量已经做完了/.test(document.body.innerText))
  await shot('08-done')
  log('一组做完：新词', learned, '早就认识', known, '跟读', shadows, '复习', reviews)
  await clickText('好的')
  await sleep(600)
  await shot('09-today-after')
  log('今天页（做完后）', (await text()).replace(/\s+/g, ' ').match(/今日练习.*?跟读.*?\d+\/\d+|今天的练习完成了.*?跟读.*?\d+\/\d+/)?.[0])

  for (const [tab, name] of [['词库', '10-words'], ['进步', '11-progress'], ['设置', '12-settings']]) {
    await clickText(tab, '.tab'); await sleep(700); await shot(name)
  }
  log('词库', (await (async () => { await clickText('词库', '.tab'); await sleep(400); return (await text()).match(/学习中 \d+/)?.[0] })()))

  // 刷新：数据还在（OPFS）
  await p.reload({ waitUntil: 'networkidle0' })
  await p.waitForFunction(() => document.body.innerText.includes('今天'))
  await clickText('设置', '.tab')
  log('刷新后存储', (await text()).match(/保存在\s*(.+)/)?.[1])
  await clickText('今天', '.tab')
  log('刷新后今天页', (await text()).replace(/\s+/g, ' ').match(/新词.*?\d+\/\d+/)?.[0])

  // 深色
  await clickText('设置', '.tab'); await clickText('深色'); await clickText('今天', '.tab'); await sleep(400); await shot('13-today-dark')
  await clickText('设置', '.tab'); await clickText('跟随系统')

  // 断网：停掉服务器后刷新，应该从离线缓存打开
  if (process.env.SERVER_PID) {
    process.kill(Number(process.env.SERVER_PID), 'SIGTERM'); await sleep(800)
    await p.reload({ waitUntil: 'domcontentloaded' })
    await p.waitForFunction(() => document.body.innerText.includes('今天'), { timeout: 30000 })
    log('断网刷新', (await text()).includes('今日练习') || (await text()).includes('今天的练习完成了') ? '正常打开' : '异常')
    await shot('14-offline')
  }
} finally {
  console.log('错误', JSON.stringify(errors.filter((e) => !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED/.test(e)), null, 1))
  await b.close()
  rmSync(dir, { recursive: true, force: true })
}

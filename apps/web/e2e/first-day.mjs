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
  const audioHits = []
  p.on('response', (r) => { if (r.url().includes('/audio/')) audioHits.push(`${r.status()} ${r.url().replace(/^.*\/audio\//, '')}`) })
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
  await p.waitForSelector('.quiz-word', { timeout: 60000 })
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
  let learned = 0, known = 0, shadows = 0, reviews = 0, listens = 0
  for (let guard = 0; guard < 80; guard++) {
    const kind = await p.evaluate(() => document.querySelector('.session .step-kind')?.textContent ?? '')
    if (!kind) break
    if (kind.startsWith('新词')) {
      if (learned === 0) {
        await shot('06-learn')
        // 示范读音：课程开始时在后台从音频包（/audio/…mp3）提前下载，点播放直接用本机缓存
        await sleep(3000)
        const played = await p.evaluate(async () => { const b = document.querySelector('.session-body .icon-btn'); b.click(); await new Promise((r) => setTimeout(r, 2500)); return document.querySelector('.toast')?.textContent ?? 'ok' })
        log('音频包请求', audioHits.length, '条，例如', audioHits.slice(0, 3).join(' / '), '· 点播放', played)
      }
      if (learned + known === 2) { await clickText('早就认识'); known++ } else { await clickText('记下了'); learned++ }
    } else if (kind.startsWith('听力')) {
      // 听音选义：随便选第一个，看对错反馈和原句出来
      await p.evaluate(() => document.querySelector('.session .options .opt').click()); await sleep(300)
      const fb = await p.evaluate(() => ({ right: !!document.querySelector('.opt.right'), sentence: document.querySelector('.session .example .en')?.textContent }))
      if (listens === 0) { log('听力题', JSON.stringify(fb)); await shot('07b-listen') }
      listens++
      await clickText('下一题')
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
  log('一组做完：新词', learned, '早就认识', known, '听力', listens, '跟读', shadows, '复习', reviews)
  await clickText('好的')
  await sleep(600)
  await shot('09-today-after')
  log('今天页（做完后）', (await text()).replace(/\s+/g, ' ').match(/今日练习.*?跟读.*?\d+\/\d+|今天的练习完成了.*?跟读.*?\d+\/\d+/)?.[0])

  for (const [tab, name] of [['发音', '10a-lab'], ['词库', '10-words'], ['进步', '11-progress'], ['设置', '12-settings']]) {
    await clickText(tab, '.tab'); await sleep(700); await shot(name)
  }
  log('进步页分项', (await text()).replace(/\s+/g, ' ').match(/分项.*?发音 \S+ \S+/)?.[0])

  // 发音实验室：音标口型卡、最小对立听辨两题
  await clickText('发音', '.tab'); await sleep(300)
  await p.evaluate(() => [...document.querySelectorAll('.phone-chips button')].find((b) => b.textContent === 'θ').click()); await sleep(500)
  await shot('10b-phone')
  log('口型卡', (await text()).replace(/\s+/g, ' ').match(/舌尖伸到[^·]*/)?.[0])
  await p.click('.session-top .icon-btn'); await sleep(300)
  await clickText('听辨'); await sleep(400)
  for (let k = 0; k < 2; k++) { await p.evaluate(() => document.querySelector('.session .options .opt').click()); await sleep(300); await clickText('下一题') }
  await shot('10c-pairs')
  await p.click('.session-top .icon-btn'); await sleep(300)
  log('最小对立统计', (await text()).replace(/\s+/g, ' ').match(/听辨 \S+/)?.[0])

  // 改目标：改完要回到主界面（v0.0.3 的 bug：会卡在引导页出不来）
  await clickText('设置', '.tab'); await clickText('修改'); await clickText('下一步'); await clickText('保存'); await sleep(500)
  log('改目标后回到主界面', await p.evaluate(() => !!document.querySelector('.tabbar')))
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
    const offErr = []
    p.on('console', (m) => offErr.push(m.type() + ' ' + m.text().slice(0, 200)))
    p.on('requestfailed', (r) => offErr.push('请求失败 ' + r.url().replace(BASE, '')))
    await p.reload({ waitUntil: 'domcontentloaded' })
    await p.waitForFunction(() => /今日练习|今天的练习完成了/.test(document.body.innerText), { timeout: 30000 }).catch(() => {})
    const okOff = /今日练习|今天的练习完成了/.test(await text())
    log('断网刷新', okOff ? '正常打开' : '异常', okOff ? '' : JSON.stringify(offErr.slice(0, 12)))
    await shot('14-offline')
  }
} catch (e) {
  // 出错时留一张当时的画面 + 页面文字，方便定位
  const p = (await b.pages()).at(-1)
  await p?.screenshot({ path: join(OUT, 'e2e-zz-fail.png') }).catch(() => {})
  console.log('失败时页面：', (await p?.evaluate(() => document.body.innerText).catch(() => ''))?.replace(/\s+/g, ' ').slice(0, 400))
  throw e
} finally {
  console.log('错误', JSON.stringify(errors.filter((e) => !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED/.test(e)), null, 1))
  await b.close()
  rmSync(dir, { recursive: true, force: true })
}

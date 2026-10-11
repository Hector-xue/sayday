// 端到端：新用户第一天。headless Chrome + 假麦克风（--use-file-for-fake-audio-capture）
// 用法: node e2e/first-day.mjs <站点URL> <输出目录> [假麦克风wav]
//   站点用 spikes/m0/serve.py --dir apps/web/dist 起在 127.0.0.1；断网测试会直接停掉服务器进程（SERVER_PID）
//   测线上：PW=<内测密码> node e2e/first-day.mjs https://sayday.ivyea.com/app/ <输出目录> [wav]
import puppeteer from 'puppeteer-core'
import { startMockAi } from './mock-ai.mjs'
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
  p.on('dialog', (d) => d.accept())
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
  // 设置不在底栏：点“今天”右上角的齿轮
  const openSettings = async () => { await clickText('今天', '.tab'); await p.waitForSelector('[aria-label="设置"]'); await p.click('[aria-label="设置"]'); await sleep(300) }

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

  for (const [tab, name] of [['发音', '10a-lab'], ['词库', '10-words'], ['进步', '11-progress']]) {
    await clickText(tab, '.tab'); await sleep(700); await shot(name)
  }
  log('进步页分项', (await text()).replace(/\s+/g, ' ').match(/分项.*?发音 \S+/)?.[0])
  await openSettings(); await sleep(400); await shot('12-settings')

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
  log('最小对立统计', (await text()).replace(/\s+/g, ' ').match(/听辨 \d+%[^说]*说对 \S+/)?.[0])

  // 剧集：第 1 集 听 → 演（录一句）→ 测 → 收词 → 完成；第 2 集要明天才解锁
  await clickText('剧集', '.tab'); await sleep(500)
  await shot('17-episodes')
  await clickText('开始看'); await sleep(500)
  for (let k = 0; k < 20; k++) {
    const has = await p.evaluate(() => [...document.querySelectorAll('.session-foot button')].some((b) => b.textContent.includes('轮到你演林')))
    if (has) break
    await clickText('下一句'); await sleep(150)
  }
  await shot('18-ep-listen')
  await clickText('轮到你演林'); await sleep(400)
  await p.click('.rec-btn'); await sleep(3000); await p.click('.rec-btn')
  await p.waitForFunction(() => document.querySelector('.ring b') || /出错|没听清/.test(document.querySelector('.rec-label')?.textContent ?? ''), { timeout: 600000 })
  await shot('19-ep-act')
  for (let k = 0; k < 10; k++) {
    if (await p.evaluate(() => document.querySelector('.step-kind')?.textContent?.startsWith('听懂了吗'))) break
    await p.evaluate(() => [...document.querySelectorAll('.session-foot button')].find((b) => /去答题|下一句|跳过/.test(b.textContent) && !b.disabled)?.click()); await sleep(300)
  }
  for (let k = 0; k < 3; k++) { await p.evaluate((k) => document.querySelectorAll('.session-body .options')[k].querySelector('.opt').click(), k); await sleep(150) }
  await shot('20-ep-quiz')
  await p.evaluate(() => [...document.querySelectorAll('.session-foot button')].find((b) => /生词|完成/.test(b.textContent)).click()); await sleep(400)
  if (await p.evaluate(() => document.body.innerText.includes('这一集的生词'))) { await clickText('全部加入').catch(() => {}); await clickText('完成这一集') }
  await p.waitForFunction(() => document.body.innerText.includes('看完了'), { timeout: 10000 })
  await shot('21-ep-done')
  await clickText('好的'); await sleep(400)
  log('剧集', (await text()).replace(/\s+/g, ' ').match(/明天解锁.{0,30}/)?.[0])

  // AI：接入（用本地假 AI 服务）→ 和 Emma 聊一句 → 写日记让 AI 改
  const mock = startMockAi(5392)
  try {
    await clickText('今天', '.tab'); await sleep(300)
    await clickText('接入你自己的 AI'); await sleep(300)
    await clickText('其他（OpenAI 兼容）')
    await p.type('input[placeholder="https://…/v1"]', 'http://127.0.0.1:5392/v1')
    await p.type('input[type="password"]', 'sk-test')
    await clickText('连接')
    await p.waitForFunction(() => /和 Emma 聊几句/.test(document.body.innerText), { timeout: 20000 })
    log('接入 AI', (await text()).includes('写今天的日记') ? '成功' : '异常')
    await p.click('.ai-grid .ai-card:nth-child(1)')
    await p.waitForSelector('.bubble.assistant', { timeout: 20000 }); await sleep(800)
    await p.type('.composer textarea', 'Yesterday I go to the park')
    await clickText('发送')
    await p.waitForSelector('.fix', { timeout: 20000 }); await sleep(500)
    await shot('15-chat')
    log('聊天', JSON.stringify(await p.evaluate(() => ({ bubbles: document.querySelectorAll('.bubble').length, fix: document.querySelector('.fix')?.textContent }))))
    // 说话输入：假麦克风放一句示范音 → 本机识别（Moonshine）→ 填进输入框
    // 本地测试要先把识别模型挂到 dist/asr/moonshine-base-q8/（见 scripts/deploy-demo.sh）
    await p.click('.mic-in'); await sleep(4000); await p.click('.mic-in')
    const heard = await p.waitForFunction(() => document.querySelector('.composer textarea')?.value, { timeout: 300000 }).then((h) => h.jsonValue()).catch(() => '（超时）')
    log('说话输入识别', JSON.stringify(heard))
    await p.click('.session-top .icon-btn'); await sleep(400)
    await p.click('.ai-grid .ai-card:nth-child(2)')
    await p.waitForSelector('.diary-edit', { timeout: 20000 })
    await p.type('.diary-edit', 'Today is very busy. I have three meeting in the morning. 下班以后我和朋友去吃火锅。')
    await clickText('帮我改')
    await p.waitForSelector('.diary-res', { timeout: 20000 }); await sleep(400)
    await shot('16-diary')
    log('日记', JSON.stringify(await p.evaluate(() => ({ edits: document.querySelectorAll('.edit').length, natural: document.querySelectorAll('.nat').length, comment: document.querySelector('.diary-res .card p')?.textContent?.slice(0, 20) }))))
    await p.click('.session-top .icon-btn'); await sleep(400)
    log('今天页日记状态', (await text()).includes('今天写过了') ? '已写' : '未显示')
    // 雅思口语模考：10 道题，每题录 3 秒（假麦克风），Part 2 跳过准备；AI（假服务）评分
    await clickText('发音', '.tab'); await sleep(300)
    await p.click('.mock-card'); await sleep(400)
    await clickText('开始')
    for (let k = 0; k < 12; k++) {
      await p.waitForFunction(() => /说完了|准备好了/.test(document.querySelector('.session-foot')?.textContent ?? '') || /模考报告|正在整理/.test(document.body.innerText), { timeout: 60000 })
      const foot = await p.evaluate(() => document.querySelector('.session-foot')?.textContent ?? '')
      if (foot.includes('准备好了')) { await clickText('准备好了'); await sleep(300); continue }
      if (foot.includes('说完了')) { if (k === 0) await shot('22-speaking-q'); await sleep(3000); await clickText('说完了'); await sleep(300); continue }
      break
    }
    await p.waitForFunction(() => document.body.innerText.includes('模考报告'), { timeout: 600000 })
    await sleep(500); await shot('23-speaking-report')
    log('口语模考', (await text()).replace(/\s+/g, ' ').match(/总分.{0,60}/)?.[0], '· 识别', JSON.stringify(await p.evaluate(() => document.querySelector('.edit .en')?.textContent)))
    await clickText('好的'); await sleep(300)
  } finally { mock.close() }

  // 改目标：改完要回到主界面（v0.0.3 的 bug：会卡在引导页出不来）
  await openSettings(); await clickText('修改'); await clickText('下一步'); await clickText('保存'); await sleep(500)
  log('改目标后回到主界面', await p.evaluate(() => !!document.querySelector('.tabbar')))
  log('词库', (await (async () => { await clickText('词库', '.tab'); await sleep(400); return (await text()).match(/学习中 \d+/)?.[0] })()))

  // 刷新：数据还在（OPFS）
  await p.reload({ waitUntil: 'networkidle0' })
  await p.waitForFunction(() => document.body.innerText.includes('今天'))
  await openSettings()
  log('刷新后存储', (await text()).match(/保存在\s*(.+)/)?.[1])
  await clickText('今天', '.tab')
  log('刷新后今天页', (await text()).replace(/\s+/g, ' ').match(/新词.*?\d+\/\d+/)?.[0])

  // 深色
  await openSettings(); await clickText('深色'); await clickText('今天', '.tab'); await sleep(400); await shot('13-today-dark')
  await openSettings(); await clickText('跟随系统')

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

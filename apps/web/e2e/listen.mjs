// 端到端：听学（网页版播放器）。新用户走完引导，打开“听学”，选“预习新词”听 10 个：
//   - 设置页能选来源、每轮词数；开始后显示当前词、音标、意思、例句，这一轮的词表里当前词高亮
//   - 不点任何按钮也会自己讲完一个词、接着讲下一个；拼读取音频包里整个词的一段；讲完的词记成“听过 1 遍”
//   - 下一个 / 上一个 / 暂停能用；关掉听学页回到今天页，入口显示“暂停在 · 某词”；再打开接着显示
//   - “换一组”回到设置页
// 声音换成假的（音频播放、系统朗读都立刻结束），不然 CI 里没有音频包、没有系统语音，要等很久
// 用法: node e2e/listen.mjs <站点URL> <输出目录>
import puppeteer from 'puppeteer-core'
import { expect, done } from './check.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const [BASE, OUT] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('·', ...a)
const dir = mkdtempSync(join(OUT, 'chrome-listen-'))
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] })
const errors = []
try {
  const p = await b.newPage()
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  p.on('dialog', (d) => d.accept())
  p.on('pageerror', (e) => errors.push(e.message))
  const reqs = []
  p.on('request', (r) => reqs.push(r.url()))
  await p.evaluateOnNewDocument(() => {
    // 假声音：音频 40ms 播完，系统朗读 40ms 读完，有一个中文和一个英文的声音
    HTMLMediaElement.prototype.play = function () { setTimeout(() => this.dispatchEvent(new Event('ended')), 40); return Promise.resolve() }
    HTMLMediaElement.prototype.pause = function () {}
    const voices = [{ lang: 'zh-CN', name: 'Fake 中文', default: true, localService: true, voiceURI: 'zh' }, { lang: 'en-US', name: 'Fake English', default: false, localService: true, voiceURI: 'en' }]
    // 真的 SpeechSynthesisUtterance 不认假声音对象（设 voice 会抛错），一起换掉
    globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t } }
    if (globalThis.speechSynthesis) {
      speechSynthesis.getVoices = () => voices
      speechSynthesis.speak = (u) => { globalThis.__said = (globalThis.__said || 0) + 1; setTimeout(() => u.onend?.(new Event('end')), 40) }
      speechSynthesis.cancel = () => {}
    }
  })
  const text = () => p.evaluate(() => document.body.innerText)
  const clickText = async (t, sel = 'button', timeout = 30000) => {
    await p.waitForFunction((t, sel) => [...document.querySelectorAll(sel)].some((x) => x.textContent.trim().startsWith(t) && !x.disabled), { timeout }, t, sel)
    await p.evaluate((t, sel) => [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().startsWith(t) && !x.disabled).click(), t, sel)
    await sleep(250)
  }
  const word = () => p.evaluate(() => document.querySelector('.hear-word')?.textContent ?? '')
  const current = () => p.evaluate(() => document.querySelector('.list-row[aria-current="true"] b')?.textContent ?? '')
  /** 等当前词变成 / 变掉（按钮按下后页面马上刷新，最多等 3 秒） */
  const waitWord = (pred, arg) => p.waitForFunction(pred, { timeout: 3000 }, arg).catch(() => {})

  await p.goto(BASE, { waitUntil: 'networkidle0' })
  await clickText('开始'); await clickText('7.0'); await clickText('下一步'); await clickText('20 分钟'); await clickText('下一步'); await clickText('开始测')
  await p.waitForSelector('.quiz-word', { timeout: 60000 })
  for (let k = 0; k < 200 && (await p.$('.quiz-word')); k++) await clickText('不认识')
  await clickText('开始今天的练习')
  await p.waitForFunction(() => document.body.innerText.includes('今日练习'))
  log('走完引导')

  // 打开听学
  await clickText('听学', 'button.hear-entry')
  await p.waitForFunction(() => document.body.innerText.includes('听什么'), { timeout: 10000 })
  await clickText('预习新词', '.hear-src')
  await clickText('10 词', '.seg button')
  await p.screenshot({ path: join(OUT, 'listen-setup.png') })
  const setup = await text()
  expect(['今天的词', '快忘的词', '最近学的', '预习新词', '拼写', '中文讲解', '例句', '循环'].every((t) => setup.includes(t)), '设置页有四种来源和四个开关')
  await clickText('开始听')
  await p.waitForSelector('.hear-word', { timeout: 15000 })
  const w1 = await word()
  const rows = await p.evaluate(() => document.querySelectorAll('.session-body .list-row:not(.hear-src)').length)
  expect(!!w1, '开始后显示当前词', w1)
  expect(rows === 10, '这一轮列出 10 个词', rows)
  expect((await current()) === w1, '词表里高亮当前词', await current())
  expect(await p.evaluate(() => !!document.querySelector('.hear-gloss')?.textContent), '显示中文意思')
  expect(!(await text()).includes('没有中文语音'), '有中文语音时不提示')
  await p.screenshot({ path: join(OUT, 'listen-playing.png') })

  // 不点按钮：自己讲完一个词接着讲下一个
  await p.waitForFunction((w) => document.querySelector('.hear-word')?.textContent !== w, { timeout: 30000 }, w1)
  const w2 = await word()
  expect(w2 && w2 !== w1, '自动讲到下一个词', `${w1} → ${w2}`)
  expect((await current()) === w2, '高亮跟着换', await current())
  const said = await p.evaluate(() => globalThis.__said || 0)
  // 中文释义、例句译文先找音频包 zh/<键>.mp3（这里的本地站点没有音频包），找不到才用系统语音顶上
  const zhReq = reqs.filter((u) => /\/audio\/zh\/[0-9a-z]+\.mp3$/.test(u))
  expect(zhReq.length >= 2, '中文讲解从音频包 zh/ 取', zhReq.slice(0, 2))
  expect(said >= 2, '音频包里没有时，中文用系统语音顶上', said)
  // 拼读是音频包里整个词一段（p/<单词>.mp3），不是一个个字母
  const spell = reqs.filter((u) => /\/audio\/(us|gb)\/p\/[^/]+\.mp3$/.test(u))
  expect(spell.some((u) => u.endsWith(`/p/${encodeURIComponent(w1)}.mp3`)), '拼读从音频包取整个词的一段', spell.slice(0, 2))
  expect(!reqs.some((u) => /\/letters\//.test(u)), '不再取单个字母的音频')

  // 下一个 / 上一个
  await p.click('[aria-label="下一个"]'); await waitWord((w) => document.querySelector('.hear-word')?.textContent !== w, w2)
  const w3 = await word()
  expect(w3 && w3 !== w2, '下一个', `${w2} → ${w3}`)
  await p.click('[aria-label="上一个"]'); await waitWord((w) => document.querySelector('.hear-word')?.textContent === w, w2)
  const back = await word()
  expect(back === w2, '刚开始讲时点上一个回到上一个词', back)
  // 暂停
  await p.click('[aria-label="暂停"]'); await sleep(600)
  expect(!!(await p.$('[aria-label="播放"]')), '暂停后按钮变成播放')
  const paused = await word()
  await sleep(1500)
  expect((await word()) === paused, '暂停后不往下讲', `${paused} → ${await word()}`)

  // 关掉回到今天页：入口显示暂停在哪个词；再打开接着显示，讲完的词记成“听过 1 遍”
  await p.click('.session-top [aria-label="关闭"]')
  await p.waitForFunction(() => /暂停在 · /.test(document.querySelector('.hear-entry')?.textContent ?? ''), { timeout: 6000 }).catch(() => {})
  const entry = await p.evaluate(() => document.querySelector('.hear-entry')?.textContent ?? '')
  expect(entry.includes(`暂停在 · ${paused}`), '今天页入口显示暂停在哪个词', entry)
  await clickText('暂停在', 'button.hear-entry')
  await p.waitForSelector('.hear-word', { timeout: 10000 })
  expect((await word()) === paused, '再打开还是那个词', await word())
  await p.waitForFunction((w) => [...document.querySelectorAll('.list-row')].some((r) => r.querySelector('b')?.textContent === w && r.textContent.includes('听过 1 遍')), { timeout: 8000 }, w1).catch(() => {})
  const heardRow = await p.evaluate((w) => [...document.querySelectorAll('.list-row')].find((r) => r.querySelector('b')?.textContent === w)?.textContent ?? '', w1)
  expect(heardRow.includes('听过 1 遍'), '讲完的词记成听过 1 遍', heardRow)

  // 换一组：回到设置页
  await clickText('换一组')
  await p.waitForFunction(() => document.body.innerText.includes('听什么'), { timeout: 6000 }).catch(() => {})
  expect((await text()).includes('开始听'), '换一组回到设置页')
  expect(errors.length === 0, '页面没有报错', errors)
} finally {
  await b.close()
  rmSync(dir, { recursive: true, force: true })
}
done()

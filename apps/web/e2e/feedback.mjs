// 端到端：做题手感。新用户走完引导、接上假 AI，然后把日期往后拨，连练三天（每天做一组）：
//   - 答题有对错计数，复习连对 3 题以上出“连对 N”徽章
//   - 一组做完出结算页（用时 / 正确率 / 最长连对 / 新学的词）
//   - 听写拼错、听力选错时有“问 AI 为什么”，点了出讲解（假 AI 回 OK）
//   - 第三天练完弹里程碑“练了 3 天”，能存图
// 用法: node e2e/feedback.mjs <站点URL> <输出目录>
import puppeteer from 'puppeteer-core'
import { startMockAi } from './mock-ai.mjs'
import { expect, done } from './check.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const [BASE, OUT] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('·', ...a)
const dir = mkdtempSync(join(OUT, 'chrome-fb-'))
const mock = startMockAi(5392)
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const errors = []
const seen = { combo: 0, explain: [], results: [], celebrate: '' }
try {
  const p = await b.newPage()
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  p.on('dialog', (d) => d.accept())
  p.on('pageerror', (e) => errors.push(e.message))
  // 拨日期：localStorage.__dayOff 天（只改主线程的 Date）
  await p.evaluateOnNewDocument(() => {
    const off = Number(localStorage.getItem('__dayOff') || 0) * 86400_000
    if (!off) return
    const D = Date
    class F extends D { constructor(...a) { super(...(a.length ? a : [D.now() + off])) } static now() { return D.now() + off } }
    globalThis.Date = F
  })
  const text = () => p.evaluate(() => document.body.innerText)
  const clickText = async (t, sel = 'button', timeout = 30000) => {
    await p.waitForFunction((t, sel) => [...document.querySelectorAll(sel)].some((x) => x.textContent.trim().startsWith(t) && !x.disabled), { timeout }, t, sel)
    await p.evaluate((t, sel) => [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().startsWith(t) && !x.disabled).click(), t, sel)
    await sleep(250)
  }
  await p.goto(BASE, { waitUntil: 'networkidle0' })
  await clickText('开始'); await clickText('7.0'); await clickText('下一步'); await clickText('20 分钟'); await clickText('下一步'); await clickText('开始测')
  await p.waitForSelector('.quiz-word', { timeout: 60000 })
  for (let k = 0; k < 200 && (await p.$('.quiz-word')); k++) await clickText('不认识')
  await clickText('开始今天的练习')
  await p.waitForFunction(() => document.body.innerText.includes('今日练习'))
  // 接假 AI
  await clickText('接入你自己的 AI'); await sleep(300)
  await clickText('其他（OpenAI 兼容）')
  await p.type('input[placeholder="https://…/v1"]', 'http://127.0.0.1:5392/v1')
  await p.type('input[type="password"]', 'sk-test')
  await clickText('连接')
  await p.waitForFunction(() => /和 Emma 聊几句/.test(document.body.innerText), { timeout: 20000 })
  log('接入假 AI')

  /** 做一组：复习都点“记得”，拼写故意写错一次，听力选第一个，跟读跳过 */
  async function session(day) {
    await p.evaluate(() => [...document.querySelectorAll('.today-card .btn.primary')][0].click())
    await p.waitForSelector('.session', { timeout: 20000 })
    let wroteWrong = false
    for (let k = 0; k < 80; k++) {
      await sleep(350)
      if (await p.$('.result')) break
      if ((await text()).includes('今天的量已经做完了')) { await clickText('好的'); return null }
      const kind = await p.evaluate(() => document.querySelector('.session-body .step-kind')?.textContent ?? '')
      const combo = await p.evaluate(() => document.querySelector('.combo')?.textContent ?? '')
      if (combo) seen.combo = Math.max(seen.combo, Number(combo.replace(/\D/g, '')))
      if (kind.startsWith('复习 · 还记得')) { await clickText('看答案'); await clickText('记得') }
      else if (kind.startsWith('复习 · 听音写词')) {
        const w = await p.evaluate(() => document.querySelector('.spell-input').value)
        await p.type('.spell-input', wroteWrong ? 'x' : 'qqq'); await clickText('提交')
        if (!wroteWrong) {
          wroteWrong = true
          await clickText('问 AI 为什么'); await p.waitForSelector('.explain p', { timeout: 10000 }); await sleep(300)
          seen.explain.push('拼写：' + (await p.evaluate(() => document.querySelector('.explain').innerText.replace(/\s+/g, ' '))))
          await p.screenshot({ path: join(OUT, 'fb-explain-spell.png') })
        }
        await clickText('下一个')
      } else if (kind.startsWith('新词')) await clickText('记下了')
      else if (kind.startsWith('听力')) {
        await p.evaluate(() => document.querySelector('.options .opt').click()); await sleep(300)
        if (await p.$('.explain-btn')) {
          await clickText('问 AI 为什么'); await p.waitForSelector('.explain p', { timeout: 10000 }); await sleep(300)
          if (!seen.explain.some((x) => x.startsWith('听力'))) { seen.explain.push('听力：' + (await p.evaluate(() => document.querySelector('.explain').innerText.replace(/\s+/g, ' ')))); await p.screenshot({ path: join(OUT, 'fb-explain-listen.png') }) }
        }
        await clickText('下一题')
      } else if (kind.startsWith('跟读')) await clickText('跳过')
      else if (kind.startsWith('每周小测')) { await clickText('开始').catch(() => {}); for (let j = 0; j < 40 && (await p.$('.quiz-word')); j++) await clickText('认识') }
    }
    await p.waitForSelector('.result', { timeout: 20000 })
    await sleep(1200)
    const r = await p.evaluate(() => document.querySelector('.result').innerText.replace(/\s+/g, ' '))
    seen.results.push(`第 ${day} 天：${r}`)
    await p.screenshot({ path: join(OUT, `fb-result-${day}.png`) })
    const btn = await p.evaluate(() => document.querySelector('.session-foot .btn').textContent)
    await clickText(btn)
    await sleep(800)
    if (await p.$('.celebrate')) {
      await sleep(1500)
      seen.celebrate = await p.evaluate(() => document.querySelector('.celebrate').innerText.replace(/\s+/g, ' '))
      log(`第 ${day} 天庆祝页`, seen.celebrate)
      await p.screenshot({ path: join(OUT, `fb-celebrate-${day}.png`) })
      await clickText('存成图片'); await sleep(1500)
      log('存图后提示', await p.evaluate(() => document.querySelector('.toast')?.textContent ?? '（无提示，走了下载）'))
      await clickText('好')
      return 'celebrated'
    }
    return 'ok'
  }

  for (let day = 1; day <= 3; day++) {
    if (day > 1) {
      await p.evaluate((d) => localStorage.setItem('__dayOff', String(d)), day - 1)
      await p.goto(BASE, { waitUntil: 'networkidle0' })
      await p.waitForFunction(() => document.body.innerText.includes('今日练习'), { timeout: 30000 })
    }
    const r = await session(day)
    log(`第 ${day} 天`, r)
    expect(day < 3 ? r === 'ok' : r === 'celebrated', `第 ${day} 天${day < 3 ? '正常做完一组' : '做完弹里程碑庆祝'}`, r)
  }
  // 设置里的答题音效开关
  await p.click('[aria-label="设置"]'); await sleep(500)
  const sfx = await p.evaluate(() => [...document.querySelectorAll('.set-row')].find((x) => x.textContent.includes('答题音效'))?.innerText.replace(/\s+/g, ' ') ?? '')
  expect(sfx.includes('答题音效'), '设置里有答题音效开关', sfx)
  log('最高连对徽章', seen.combo)
  for (const r of seen.results) log('结算', r)
  for (const e of seen.explain) log('讲解', e)
  expect(seen.celebrate.includes('练了 3 天'), '第 3 天的里程碑是“练了 3 天”', seen.celebrate)
  expect(seen.combo >= 3, '复习连对 3 题以上出连对徽章', seen.combo)
  expect(seen.results.length === 3 && seen.results.every((r) => /正确率/.test(r) && /最长连对/.test(r) && /用时/.test(r)), '每天做完都有结算页（用时 / 正确率 / 最长连对）', seen.results.length)
  expect(seen.explain.some((e) => e.startsWith('听力') && e.includes('OK')), '听力选错能问 AI，出讲解', seen.explain)
  expect(errors.length === 0, '页面没有报错', errors)
} finally {
  await b.close()
  mock.close()
  rmSync(dir, { recursive: true, force: true })
}
done()

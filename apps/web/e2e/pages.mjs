// 端到端：主要页面走一遍（v0.0.36 的几处修正都在这里核对），每页截图
//   - 定级时最常用那档手滑点错两个：新词不会被拉回 say / go 这种词
//   - 学完一组：今天页的“复习”不变多，词库里刚学的词标“明天”
//   - 学词卡：音标是新写法（不出现 ә、ei 这种老写法），意思只留常用的
//   - 今天页只放每天要做的；模考、雅思单项、AI、工作英语都在“专项”页签
//   - 进步页：C1 的人“升 C2 还差 N 个词”N 不是 0；四项不到三项有分时不画雷达图
// 用法: node e2e/pages.mjs <站点URL> <输出目录>
import puppeteer from 'puppeteer-core'
import { expect, done } from './check.mjs'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [BASE, OUT] = process.argv.slice(2)
const root = new URL('../../../', import.meta.url).pathname
const words = JSON.parse(readFileSync(join(root, 'content/pack/words.json')))
const pseudo = new Set(JSON.parse(readFileSync(join(root, 'content/pack/pseudo.json'))))
const rank = new Map(words.map((w) => [w[0], w[1]]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('·', ...a)
const dir = mkdtempSync(join(OUT, 'chrome-pages-'))
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const errors = []
try {
  const p = await b.newPage()
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('dialog', (d) => d.accept())
  // 发音模型（120MB）这里用不上，不下
  await p.setRequestInterception(true)
  p.on('request', (r) => (/phone_ctc|\.onnx/.test(r.url()) ? r.abort() : r.continue()))
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const shot = (n, fullPage = false) => p.screenshot({ path: join(OUT, `pages-${n}.png`), fullPage })
  const text = () => p.evaluate(() => document.body.innerText)
  const clickText = async (t, sel = 'button', timeout = 30000) => {
    await p.waitForFunction((t, sel) => [...document.querySelectorAll(sel)].some((x) => x.textContent.trim().startsWith(t) && !x.disabled), { timeout }, t, sel)
    await p.evaluate((t, sel) => [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().startsWith(t) && !x.disabled).click(), t, sel)
    await sleep(300)
  }

  await p.goto(BASE, { waitUntil: 'networkidle2' })
  await clickText('开始'); await clickText('7.0'); await clickText('下一步'); await clickText('20 分钟'); await clickText('下一步'); await clickText('开始测')
  await p.waitForSelector('.quiz-word', { timeout: 60000 })
  // 认识前 6000 个词，但最常用那档手滑点错两个
  let slips = 0
  for (let k = 0; k < 200; k++) {
    const w = await p.evaluate(() => document.querySelector('.quiz-word')?.textContent)
    if (!w) break
    let yes = !pseudo.has(w) && (rank.get(w) ?? 99999) <= 6000
    if (yes && (rank.get(w) ?? 99999) <= 500 && slips < 2) { yes = false; slips++ }
    await clickText(yes ? '认识' : '不认识')
  }
  await p.waitForFunction(() => document.body.innerText.includes('你的起点'))
  log('定级', (await text()).match(/你的起点\s+(\S+)/)?.[1], (await text()).match(/约 [\d,]+ 词/)?.[0], '手滑', slips)
  await clickText('开始今天的练习')
  await p.waitForFunction(() => document.body.innerText.includes('今日练习'))
  await sleep(800)
  await shot('01-today', true)
  const today0 = await text()
  for (const gone of ['雅思全真模考', '工作英语', '离目标', '雅思专项', '接入你自己的 AI']) expect(!today0.includes(gone), `今天页不再放“${gone}”`)
  expect(today0.includes('听学'), '今天页有听学入口')
  const reviewRow = () => p.evaluate(() => [...document.querySelectorAll('.today-list li')].find((li) => li.textContent.includes('复习'))?.querySelector('.n')?.textContent)
  const rv0 = await reviewRow()

  // 做一组：新词记下、听力选第一个、跟读跳过
  await clickText('开始')
  await p.waitForSelector('.session .step-kind')
  const learned = []
  for (let g = 0; g < 80; g++) {
    if (await p.$('.result')) break
    const kind = await p.evaluate(() => document.querySelector('.session .step-kind')?.textContent ?? '')
    if (!kind) { await sleep(300); continue }
    if (kind.startsWith('新词')) {
      const card = await p.evaluate(() => ({ w: document.querySelector('.word-big')?.textContent, ipa: document.querySelector('.session-body .ipa')?.textContent ?? '', zh: document.querySelector('.session-body .zh-mean')?.textContent ?? '' }))
      if (!learned.length) {
        await shot('02-learn')
        log('第一张学词卡', JSON.stringify(card))
        expect(!/[әє]|ei\b|ai\b|:/.test(card.ipa), '音标是新写法（没有 ә、ei、: 这种老写法）', card.ipa)
        const senses = card.zh.split(/[；;]/).map((g) => g.replace(/^[a-z]+\.\s*/i, '').split(/[,，]/).length)
        expect(card.zh.split(/[；;]/).length <= 3 && senses.every((n, i) => n <= (i ? 2 : 3)), '意思最多三种词性、第一种三个其余两个', card.zh)
      }
      learned.push(card.w)
      await clickText('记下了')
    } else if (kind.startsWith('听力')) { await p.evaluate(() => document.querySelector('.session .options .opt').click()); await sleep(300); await clickText('下一题') }
    else if (kind.startsWith('复习')) { await clickText('看答案').catch(() => {}); await clickText('记得').catch(() => {}) }
    else await clickText('跳过')
  }
  await p.waitForSelector('.result', { timeout: 20000 })
  await sleep(1200)
  await shot('03-result')
  const ranks = learned.map((w) => rank.get(w) ?? 99999)
  log('新学的词', learned.join(' '), '排名', ranks.join(' '))
  expect(ranks.length > 0 && Math.min(...ranks) > 3000, '定级手滑两个也不从最常用的词教起（新词都在第 3000 名以后）', Math.min(...ranks))
  expect(!(await p.$('.toast')), '结算页上没有挂着“跳过了”的提示', await p.evaluate(() => document.querySelector('.toast')?.textContent))
  await clickText('好的'); await sleep(800)
  const rv1 = await reviewRow()
  log('今天页复习', rv0, '→', rv1)
  expect(rv0 === rv1, '学完一组，今天的“复习”不变多（刚学的词明天才复习）', `${rv0} → ${rv1}`)
  await shot('04-today-after', true)

  await clickText('词库', '.tab'); await sleep(900)
  const sides = await p.evaluate(() => [...document.querySelectorAll('.list-row .side')].map((x) => x.textContent))
  expect(sides.length > 0 && sides.every((x) => x.startsWith('明天')), '词库里刚学的词标“明天”', sides.slice(0, 3))
  await shot('05-words', true)

  await clickText('专项', '.tab'); await sleep(900)
  const lab = await text()
  for (const want of ['雅思全真模考', '听力', '阅读', '口语模考', '写作', '接入你自己的 AI', '工作英语', '30 秒专注', '最小对立', '音标口型']) expect(lab.includes(want), `“专项”页签有“${want}”`)
  await shot('06-lab', true)

  await clickText('进步', '.tab'); await sleep(1200)
  const prog = (await text()).replace(/\s+/g, ' ')
  const mile = prog.match(/再认识约 ([\d,]+) 个词 → 升 (\S+)/)
  log('里程碑', mile?.[0])
  expect(!mile || Number(mile[1].replace(/,/g, '')) > 0, '升下一档还差的词数不是 0', mile?.[0])
  const four = await p.evaluate(() => ({ radar: !!document.querySelector('svg.radar'), four: document.querySelector('.band-four')?.innerText.replace(/\s+/g, ' ') ?? '' }))
  expect(!four.radar && four.four.includes('阅读'), '刚定完级只有阅读有分：不画雷达图，四项并排列', four)
  await shot('07-progress', true)
  expect(errors.length === 0, '页面没有报错', errors.slice(0, 3))
} finally {
  await b.close()
  rmSync(dir, { recursive: true, force: true })
}
done()

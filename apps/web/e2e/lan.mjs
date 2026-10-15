// 端到端：面对面同步。两个浏览器当两台设备，原生收发（src/lan.rs）用 node 里的假中转代替，
// 其余（快照、加密、合并、界面）都是真的：
//   1. A 走完引导、选兴趣“美食”；B 新装，欢迎页“接过来”→ 手动输入 A 出码的地址和配对码 → B 直接有 A 的档案
//   2. B 改兴趣加“旅行”；A 再出码，B 在设置里扫（手动输入）→ A 也有“旅行”
//   3. A 出码的二维码能被 jsQR 认出来，内容就是地址 + 配对码
// 用法: node e2e/lan.mjs <站点URL> <输出目录>
import puppeteer from 'puppeteer-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import jsQR from 'jsqr'

const [BASE, OUT] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('·', ...a)

// 假的原生收发：和 lan.rs 一样的语义（出码的一方等一个 tag 对的连接，一来一回）
const relay = { host: null, got: null }
async function native(cmd, a) {
  if (cmd === 'lan_host') { relay.host = { payload: a.payload, tag: a.tag }; relay.got = null; return [47231, ['192.168.1.5']] }
  if (cmd === 'lan_poll') { const g = relay.got; if (g) { relay.got = null; relay.host = null } return g }
  if (cmd === 'lan_stop') { relay.host = null; return null }
  if (cmd === 'lan_send') {
    if (!relay.host || !a.addrs.includes('192.168.1.5')) throw '连不上 192.168.1.5:47231：Connection refused'
    if (a.tag !== relay.host.tag) throw '配对码不对'
    relay.got = a.payload
    return relay.host.payload
  }
  if (cmd === 'plugin:sayday-infer|lan_addrs') return { addrs: [] }
  throw new Error('未知命令 ' + cmd)
}

const dirs = []
const errors = []
async function device(name) {
  const dir = mkdtempSync(join(OUT, `chrome-lan-${name}-`))
  dirs.push(dir)
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
  const p = await b.newPage()
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  p.on('dialog', (d) => d.accept())
  p.on('pageerror', (e) => errors.push(`${name} pageerror ${e.message}`))
  await p.exposeFunction('__lanNative', (cmd, a) => native(cmd, a).then((v) => ({ v }), (e) => ({ e: String(e) })))
  // 只给 __TAURI_INTERNALS__（桌面版也是这样）：别的功能仍按网页版走
  await p.evaluateOnNewDocument(() => { window.__TAURI_INTERNALS__ = { invoke: async (cmd, a) => { const r = await window.__lanNative(cmd, a ?? {}); if ('e' in r) throw r.e; return r.v } } })
  await p.goto(BASE, { waitUntil: 'networkidle0' })
  const clickText = async (t, sel = 'button') => {
    await p.waitForFunction((t, sel) => [...document.querySelectorAll(sel)].some((x) => x.textContent.trim().startsWith(t) && !x.disabled), { timeout: 60000 }, t, sel)
    await p.evaluate((t, sel) => [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().startsWith(t) && !x.disabled).click(), t, sel)
    await sleep(250)
  }
  const shot = (n) => p.screenshot({ path: join(OUT, `lan-${name}-${n}.png`) })
  const settings = async () => { await clickText('今天', '.tab'); await p.waitForSelector('[aria-label="设置"]'); await p.click('[aria-label="设置"]'); await sleep(400) }
  const interests = () => p.evaluate(() => [...document.querySelectorAll('.chip[aria-pressed="true"]')].map((x) => x.textContent).join('、'))
  return { b, p, clickText, shot, settings, interests }
}
/** A 出码：返回界面上显示的地址和配对码 */
async function hostOn(D) {
  await D.settings()
  await D.clickText('开始', '.set-row button')
  await D.clickText('在这台出码', '.lan-pick')
  await D.p.waitForSelector('.lan-qr', { timeout: 20000 })
  const [addr, code] = await D.p.evaluate(() => [...document.querySelectorAll('.lan-manual b')].map((x) => x.textContent))
  return { addr, code }
}
async function typeIn(D, { addr, code }) {
  await D.p.waitForSelector('.lan-field input', { timeout: 20000 })
  const [a, c] = await D.p.$$('.lan-field input')
  await a.type(addr); await c.type(code)
  await D.clickText('连接')
}

try {
  const A = await device('a')
  await A.clickText('开始'); await A.clickText('7.0'); await A.clickText('下一步'); await A.clickText('20 分钟'); await A.clickText('下一步'); await A.clickText('开始测')
  await A.p.waitForSelector('.quiz-word', { timeout: 60000 })
  for (let k = 0; k < 200 && (await A.p.$('.quiz-word')); k++) await A.clickText('不认识')
  await A.clickText('开始今天的练习')
  await A.p.waitForFunction(() => document.body.innerText.includes('今日练习'))
  await A.settings()
  await A.clickText('美食', '.chip'); await sleep(300)
  log('A 设置里的同步行', await A.p.evaluate(() => [...document.querySelectorAll('.set-row')].filter((x) => /面对面|自建/.test(x.textContent)).map((x) => x.innerText.replace(/\s+/g, ' ')).join(' | ')))
  await A.shot('settings')

  // 1. A 出码，B 新装从欢迎页接过来
  const s1 = await hostOn(A)
  log('A 出码', JSON.stringify(s1))
  await A.shot('host')
  // 二维码能认出来
  const qr = await A.p.evaluate(async () => {
    const svg = document.querySelector('.lan-qr')
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg))
    await img.decode()
    const c = document.createElement('canvas'); c.width = c.height = 400
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 400, 400)
    const px = ctx.getImageData(0, 0, 400, 400).data
    let bin = ''; for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000))
    return btoa(bin)
  })
  const px = new Uint8ClampedArray(Buffer.from(qr, 'base64'))
  log('二维码认出来', jsQR(px, 400, 400)?.data)

  const B = await device('b')
  await B.clickText('在别的设备上用过')
  await B.p.waitForFunction(() => document.body.innerText.includes('从旧设备接过来'))
  // 无头浏览器没有摄像头：应该自动转到手动输入
  await B.p.waitForSelector('.lan-field', { timeout: 20000 })
  log('B 接过来页', (await B.p.evaluate(() => document.querySelector('.onb').innerText.replace(/\s+/g, ' '))).slice(0, 200))
  await B.shot('join')
  const nav = B.p.waitForNavigation({ timeout: 30000 }).catch(() => null)
  await typeIn(B, s1)
  await nav
  await B.p.waitForFunction(() => document.body.innerText.includes('今日练习'), { timeout: 30000 })
  await A.p.waitForFunction(() => document.body.innerText.includes('合好了'), { timeout: 20000 })
  log('A 出码后看到', await A.p.evaluate(() => document.querySelector('.lan-box').innerText.replace(/\s+/g, ' ')))
  await A.shot('done')
  await A.clickText('好了')
  await B.settings()
  log('B 接过来后的兴趣（应该是 A 选的美食）', await B.interests())

  // 2. B 加“旅行”；A 再出码，B 在设置里扫
  await B.clickText('旅行', '.chip'); await sleep(300)
  await A.p.waitForFunction(() => !document.querySelector('.lan-page'), { timeout: 10000 }).catch(() => {})
  const s2 = await hostOn(A)
  await B.clickText('开始', '.set-row button'); await B.clickText('扫另一台的码', '.lan-pick')
  await typeIn(B, s2)
  await B.p.waitForFunction(() => document.body.innerText.includes('合好了'), { timeout: 20000 })
  log('B 看到', await B.p.evaluate(() => document.querySelector('.lan-box').innerText.replace(/\s+/g, ' ')))
  await A.p.waitForFunction(() => document.body.innerText.includes('合好了'), { timeout: 20000 })
  const navA = A.p.waitForNavigation({ timeout: 30000 }).catch(() => null)
  await A.clickText('好了'); await navA
  await A.p.waitForFunction(() => document.body.innerText.includes('今日练习'), { timeout: 30000 })
  await A.settings()
  log('A 同步回来的兴趣（应该有旅行）', await A.interests())

  // 配对码错
  const s3 = await hostOn(A)
  await B.clickText('好了').catch(() => {})
  await sleep(1500)
  await B.settings()
  await B.clickText('开始', '.set-row button'); await B.clickText('扫另一台的码', '.lan-pick')
  await typeIn(B, { addr: s3.addr, code: 'ZZZZ-ZZZZ-ZZ' })
  await B.p.waitForSelector('.lan-box .err-box', { timeout: 20000 })
  log('配对码错', await B.p.evaluate(() => document.querySelector('.lan-box .err-box').textContent))
  await B.shot('wrong')
  log('错误', JSON.stringify(errors))
  await A.b.close(); await B.b.close()
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
}

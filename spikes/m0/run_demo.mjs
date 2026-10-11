// 用模拟麦克风（--use-file-for-fake-audio-capture）在 headless Chrome 里跑通“录音→打分”全链路
// 用法: FAKE_WAV=/path/x.wav node run_demo.mjs [--coi]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const coi = process.argv.includes('--coi')
const PORT = 5288
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const srv = spawn('python3', [join(import.meta.dirname, 'serve.py'), '--port', String(PORT), ...(coi ? ['--coi'] : [])], { stdio: 'ignore' })
const userDataDir = mkdtempSync(join(process.env.SCRATCH || tmpdir(), 'chrome-demo-'))
let browser
try {
  await sleep(800)
  browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: true, userDataDir, protocolTimeout: 600000,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${process.env.FAKE_WAV}`, '--autoplay-policy=no-user-gesture-required'],
  })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('pageerror', e.message))
  await page.goto(`http://127.0.0.1:${PORT}/web/demo.html?auto=4800&text=${encodeURIComponent(process.env.TEXT || 'Mark is going to see elephant')}`)
  await page.waitForFunction('window.__result', { timeout: 600000 })
  console.log(JSON.stringify(await page.evaluate('window.__result'), null, 1))
  await page.screenshot({ path: join(process.env.SCRATCH || tmpdir(), 'demo.png'), fullPage: true })
} finally {
  if (browser) await browser.close().catch(() => {})
  srv.kill('SIGTERM')
  rmSync(userDataDir, { recursive: true, force: true })
}

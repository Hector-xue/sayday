// 驱动 headless Chrome 跑浏览器验证：首次在线 → 刷新（验证 OPFS 持久化）→ 关掉服务器再刷新（真断网：验证离线壳 + 模型缓存）
// 用法: M=int8|fp32 node run_browser.mjs <结果输出.json>
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const SCRATCH = process.env.SCRATCH || tmpdir()
const PORT = 5287
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function scenario(coi) {
  const srv = spawn('python3', [join(import.meta.dirname, 'serve.py'), '--port', String(PORT), ...(coi ? ['--coi'] : [])], { stdio: 'ignore' })
  const userDataDir = mkdtempSync(join(SCRATCH, 'chrome-m0-'))
  let browser
  try {
    await sleep(800)
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: true,
      userDataDir,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      protocolTimeout: 600000,
    })
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('pageerror', e.message))
    page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()))
    page.on('requestfailed', (r) => console.error('requestfailed', r.url(), r.failure()?.errorText))
    const url = `http://127.0.0.1:${PORT}/web/index.html?m=${process.env.M || 'int8'}`
    const grab = async () => {
      await page.waitForFunction('window.__result', { timeout: 600000 })
      return page.evaluate('window.__result')
    }
    const steps = {}
    await page.goto(url); steps.first = await grab(); console.error('step first ok')
    await page.reload(); steps.reload = await grab(); console.error('step reload ok')
    if (process.env.SKIP_OFFLINE) return { coi, steps }
    // Puppeteer 的 setOfflineMode 不影响 Service Worker 的状态判定，改成直接停掉服务器，确保是真的连不上
    srv.kill('SIGTERM'); await sleep(800)
    const probe = await page.evaluate(async (u) => { try { await fetch(u + '&probe=' + Date.now(), { cache: 'no-store' }); return 'reachable' } catch { return 'unreachable' } }, url)
    await page.reload(); steps.offline = { serverProbe: probe, ...(await grab()) }
    return { coi, steps }
  } finally {
    if (browser) await browser.close().catch(() => {})
    srv.kill('SIGTERM')
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

const results = process.env.ONLY ? [await scenario(process.env.ONLY === 'coi')] : [await scenario(false), await scenario(true)]
writeFileSync(process.argv[2], JSON.stringify(results, null, 1))
console.log(JSON.stringify(results.map((r) => ({ coi: r.coi, ...Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, { probe: v.serverProbe, online: v.online, sw: v.swControlled, db: v.db && (v.db.ok ? `${v.db.before}->${v.db.after} ins${v.db.insert10kMs}ms` : v.db.error), model: v.model && `${v.model.threads}t fetch${v.model.fetchMs} create${v.model.createMs} ` + v.model.runs.map((x) => `${x.audioS}s:${x.inferMs}ms diff${x.maxAbsDiffVsPython} agree${x.argmaxAgree}`).join(' | '), err: v.error }])) })), null, 1))

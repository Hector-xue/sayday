// node --test packages/sync-server/server.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sayday-sync-'))
process.env.DATA_DIR = dir
process.env.MIN_FREE_MB = '1'
const { handler } = await import('./server.mjs')
const srv = http.createServer(handler).listen(0, '127.0.0.1')
await new Promise((r) => srv.once('listening', r))
const base = `http://127.0.0.1:${srv.address().port}/api/sync`
const A = 'a'.repeat(40), D1 = '1'.repeat(32), D2 = '2'.repeat(32), G = 'b'.repeat(40)

test('快照：上传、列出、下载、删除', async () => {
  assert.equal((await fetch(`${base}/v1/a/${A}`)).status, 200)
  assert.deepEqual((await (await fetch(`${base}/v1/a/${A}`)).json()).devices, [])
  const blob = new Uint8Array(100).map((_, i) => i)
  assert.equal((await fetch(`${base}/v1/a/${A}/d/${D1}`, { method: 'PUT', body: blob })).status, 200)
  const l = (await (await fetch(`${base}/v1/a/${A}`)).json()).devices
  assert.equal(l.length, 1); assert.equal(l[0].dev, D1); assert.equal(l[0].size, 100)
  assert.deepEqual(new Uint8Array(await (await fetch(`${base}/v1/a/${A}/d/${D1}`)).arrayBuffer()), blob)
  assert.equal((await fetch(`${base}/v1/a/${A}/d/${D1}`, { method: 'DELETE' })).status, 200)
  assert.equal((await fetch(`${base}/v1/a/${A}/d/${D1}`)).status, 404)
})
test('id 不合法、太大都拒绝', async () => {
  assert.equal((await fetch(`${base}/v1/a/../../etc`)).status, 404)
  assert.equal((await fetch(`${base}/v1/a/xyz`)).status, 400)
  assert.equal((await fetch(`${base}/v1/a/${A}/d/${D2}`, { method: 'PUT', body: new Uint8Array(7 * 1024 * 1024) })).status, 413)
})
test.after(() => { srv.close(); rmSync(dir, { recursive: true, force: true }) })

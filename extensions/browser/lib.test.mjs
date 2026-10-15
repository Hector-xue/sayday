// node --test extensions/browser/lib.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportFile, lookup, sentenceAround, snapshotOf } from './lib.js'

const words = { run: ['rʌn', 'v. 跑', 300], happy: ['ˈhæpi', 'a. 快乐的', 500], study: ['ˈstʌdi', 'n. 学习', 400] }
test('查词：变形还原到原形', () => {
  assert.equal(lookup(words, 'Running').w, 'run')
  assert.equal(lookup(words, 'happier').w, 'happy')
  assert.equal(lookup(words, 'studies').w, 'study')
  assert.equal(lookup(words, 'xyz'), null)
})
test('原句：按句号切，太长截断', () => {
  const t = 'First sentence here. I love running in the park! Last one?'
  assert.equal(sentenceAround(t, t.indexOf('running')), 'I love running in the park!')
  const long = 'A '.repeat(200) + 'target ' + 'B '.repeat(200)
  const s = sentenceAround(long, long.indexOf('target'))
  assert.ok(s.length <= 245 && s.includes('target'))
})
test('导出快照：新词卡 + 原句', () => {
  const s = snapshotOf('d', { run: { s: 'I love running.', url: 'u', title: 't', ts: 5 } }, 9)
  assert.equal(s.tables.card[0].word, 'run'); assert.equal(s.tables.card[0].state, 0); assert.equal(s.tables.card[0].last_review, null)
  assert.deepEqual(JSON.parse(s.kv.clips.v).run, { s: 'I love running.', url: 'u', title: 't', ts: 5 })
})
test('导出文件：App 认得的格式', () => {
  const f = exportFile('d', { run: { s: 'x', url: 'u', title: 't', ts: 5 } }, 9)
  assert.equal(f.app, 'sayday-clips'); assert.equal(f.snapshot.tables.card.length, 1)
})

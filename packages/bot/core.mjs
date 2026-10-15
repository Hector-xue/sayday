// 机器人的对话逻辑（和平台无关）：Telegram、飞书各自的适配层把消息转成 handle() 的输入，把返回的回复发出去。
//
//   绑定 <同步码>   绑上日日说的学习记录（机器人当成一台同步设备）
//   复习          马上来 3 道题（看英文选意思 / 看中文写拼写）
//   跟读          给一句话，发语音过来打分
//   时间 21:00    每天几点推送（默认 20:30）
//   解绑          不再读你的记录
// 每天到点主动推：3 道题 + 1 句跟读。答题按 FSRS 记进复习，App 下次同步时合进去，算当天练过。
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { Learner, dayOf } from './learner.mjs'
import { normCode, validCode } from './crypto.mjs'

export const HELP = `我是日日说的复习机器人。

绑定方法：
1. 在日日说 App 里：设置 → 数据 → 多设备同步 → 开启，复制同步码
2. 发给我：绑定 你的同步码

之后每天 20:30 我会推 3 道复习题和 1 句跟读，在聊天里就能答，答了就算今天练过。

随时可以发：
· 复习 —— 马上来 3 道题
· 跟读 —— 给你一句，发语音过来给你打分
· 时间 21:00 —— 改每天推送的时间
· 解绑 —— 我不再读你的学习记录

说明：绑定后我能读到你的学习记录（为了出题），我只跑在日日说自己的服务器上，不给任何人。`

/** 释义取第一个义项、去词性，按钮上放得下（和 App 的 quiz.ts 一样） */
export const shortZh = (zh) => String(zh).split(/[；;]/)[0].replace(/^[a-z]+\.\s*/i, '').split(/[,，]/).map((x) => x.trim()).slice(0, 2).join('，').slice(0, 12)

/** 出题：熟一点的出拼写，其余 3 选 1（和 App 的 makeQuestions 同一个规则） */
export function makeQuestions(cards, byWord, words, n = 3, rnd = Math.random) {
  const out = []
  for (const c of cards) {
    if (out.length >= n) break
    const w = byWord.get(c.word)
    if (!w) continue
    const zh = shortZh(w.zh)
    if (!zh) continue
    if (c.reps >= 2 && w.w.length >= 3 && w.w.length <= 12 && /^[a-z]+$/.test(w.w)) {
      out.push({ word: w.w, kind: 'spell', prompt: `拼出这个词：${zh}`, hint: `${w.w.length} 个字母，${w.w[0]} 开头，直接回复英文`, answer: w.w, reveal: `${w.w}${w.ipa ? ` /${w.ipa}/` : ''}` })
      continue
    }
    const near = words.filter((x) => x.w !== w.w && Math.abs(x.rank - w.rank) < 800 && !x.sensitive).map((x) => shortZh(x.zh)).filter((x) => x && x !== zh)
    const opts = new Set()
    while (opts.size < 2 && near.length) opts.add(near.splice(Math.floor(rnd() * near.length), 1)[0])
    if (opts.size < 2) continue
    const options = [...opts]
    options.splice(Math.floor(rnd() * 3), 0, zh)
    out.push({ word: w.w, kind: 'choice', prompt: `“${w.w}”是什么意思？`, hint: w.ipa ? `/${w.ipa}/` : '', options, answer: zh, reveal: `${w.w} = ${zh}` })
  }
  return out
}

/** 绑定记录存成 JSON 文件（每个聊天一份）；写临时文件再改名 */
export class Store {
  constructor(dir) { this.dir = dir; mkdirSync(dir, { recursive: true }) }
  file(chat) { return join(this.dir, createHash('sha256').update(chat).digest('hex').slice(0, 32) + '.json') }
  get(chat) { const f = this.file(chat); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null }
  put(chat, s) { const f = this.file(chat); writeFileSync(f + '.tmp', JSON.stringify(s)); renameSync(f + '.tmp', f) }
  drop(chat) { const f = this.file(chat); if (existsSync(f)) writeFileSync(f, 'null') }
  /** 所有绑定了的聊天（定时推送用） */
  list() { return readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(this.dir, f), 'utf8'))?.chat } catch { return null } }).filter(Boolean) }
}

/**
 * deps：{ api（同步服务地址）, store, content（词表）, score(audio16k, text) → { score, words }, decode(buf) → Promise<Float32Array>（16kHz）, tz（分钟） }
 * handle 返回要发的回复：[{ text, buttons?: [{ label, data }] }]
 */
export function createBot(deps) {
  const { api, store, content, tz = 480 } = deps

  const learnerOf = (s) => new Learner(api, s)
  const save = (chat, s) => store.put(chat, s)

  async function startRound(chat, s) {
    const l = learnerOf(s)
    await l.pull()
    const qs = makeQuestions(l.due(30), content.byWord, content.words, 3)
    if (!qs.length) return [{ text: '现在没有要复习的词。在 App 里学几个新词，我就能给你出题了。' }]
    s.round = { qs, i: 0, ok: 0 }
    save(chat, s)
    return [ask(s)]
  }
  function ask(s) {
    const q = s.round.qs[s.round.i]
    const head = `第 ${s.round.i + 1}/${s.round.qs.length} 题　${q.prompt}${q.hint ? `\n${q.hint}` : ''}`
    return q.kind === 'choice' ? { text: head, buttons: q.options.map((o, k) => ({ label: o, data: `a:${s.round.i}:${k}` })) } : { text: head }
  }
  async function answer(chat, s, given) {
    const r = s.round
    const q = r.qs[r.i]
    const ok = given.trim().toLowerCase() === q.answer.trim().toLowerCase()
    const l = learnerOf(s)
    await l.pull()
    l.grade(q.word, ok)
    r.ok += ok ? 1 : 0
    r.i++
    const out = [{ text: ok ? `✓ 对了：${q.reveal}` : `✗ 正确答案：${q.reveal}` }]
    if (r.i < r.qs.length) out.push(ask(s))
    else { out.push({ text: `这一轮 ${r.qs.length} 题对了 ${r.ok} 题，今天算练过了 ✓\n想跟读一句就发“跟读”。` }); s.round = null }
    save(chat, s)
    await l.push().catch(() => {})
    return out
  }
  function readTask(s) {
    // 从快到期的词里挑一个有例句的，句子不要太长
    const due = [...(s._due ?? [])]
    for (const c of due) {
      const ss = (content.sentsByWord.get(c.word) ?? []).filter((x) => x.en.length >= 20 && x.en.length <= 70)
      if (ss.length) { const x = ss[Math.floor(Math.random() * ss.length)]; return { text: x.en, zh: x.zh } }
    }
    const pool = content.sents.filter((x) => x.cefr === 'A2' && x.en.length >= 20 && x.en.length <= 60)
    const x = pool[Math.floor(Math.random() * pool.length)]
    return { text: x.en, zh: x.zh }
  }
  async function startRead(chat, s) {
    const l = learnerOf(s)
    await l.pull().catch(() => {})
    s._due = l.due(10)
    s.read = readTask(s)
    delete s._due
    save(chat, s)
    return [{ text: `跟读这句，读完发语音给我：\n\n${s.read.text}\n（${s.read.zh}）` }]
  }
  async function scoreVoice(chat, s, getAudio) {
    if (!s.read) return [{ text: '先发“跟读”，我给你一句话，再发语音过来。' }]
    let r
    try { r = await deps.score(await deps.decode(await getAudio()), s.read.text) } catch (e) { return [{ text: `这段语音我没处理好：${e.message || e}` }] }
    const bad = r.words.filter((w) => w.level === 'r').map((w) => w.word)
    const so = r.words.filter((w) => w.level === 'y').map((w) => w.word)
    const l = learnerOf(s)
    l.shadow()
    save(chat, s)
    await l.push().catch(() => {})
    const tip = r.score >= 85 ? '读得很好！' : r.score >= 70 ? '不错，再注意下面几个词。' : '慢一点，一个词一个词读清楚再试一次。'
    return [{ text: `跟读 ${r.score} 分。${tip}${bad.length ? `\n没读准：${bad.join('、')}` : ''}${so.length ? `\n还可以更准：${so.join('、')}` : ''}\n想再读一遍就直接发语音，换一句发“跟读”。` }]
  }

  async function handle(chat, msg) {
    let s = store.get(chat)
    const text = (msg.text ?? '').trim()
    if (/^\/?(start|help|帮助)$/i.test(text) || (!s && !msg.voice && !msg.action && !/^\/?(绑定|bind)/i.test(text))) return [{ text: HELP }]
    const bind = text.match(/^\/?(?:绑定|bind)\s*(.*)$/i)
    if (bind) {
      if (!validCode(bind[1])) return [{ text: '同步码不对。在 App 里：设置 → 数据 → 多设备同步 → 同步码 → 显示，抄过来发“绑定 XXXX-XXXX-…”' }]
      const code = normCode(bind[1])
      s = { chat, code, dev: s?.dev ?? randomBytes(16).toString('hex'), hour: s?.hour ?? 20, minute: s?.minute ?? 30, tz, last: '' }
      const l = learnerOf(s)
      let v
      try { v = await l.pull() } catch (e) { return [{ text: `连不上同步服务：${e.message || e}` }] }
      if (!v.profile && !v.cards.size) return [{ text: '这个同步码下还没有学习记录。先在 App 里点“立即同步”，再发一次绑定。' }]
      save(chat, s)
      await l.push().catch(() => {})
      return [{ text: `绑好了：找到 ${v.cards.size} 个词卡。每天 ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')} 我会推 3 道题和 1 句跟读。现在就来几题？发“复习”。` }]
    }
    if (!s) return [{ text: HELP }]
    if (/^\/?(解绑|unbind)$/i.test(text)) { await learnerOf(s).leave(); store.drop(chat); return [{ text: '已解绑，我不再读你的学习记录了。' }] }
    const time = text.match(/^\/?(?:时间|time)\s*(\d{1,2})[:：](\d{2})$/i)
    if (time) {
      const h = +time[1], m = +time[2]
      if (h > 23 || m > 59) return [{ text: '时间写成 21:00 这样' }]
      s.hour = h; s.minute = m; save(chat, s)
      return [{ text: `好，以后每天 ${time[1].padStart(2, '0')}:${time[2]} 推送。` }]
    }
    if (/^\/?(复习|review)$/i.test(text)) return startRound(chat, s)
    if (/^\/?(跟读|read)$/i.test(text)) return startRead(chat, s)
    if (msg.voice) return scoreVoice(chat, s, msg.voice)
    if (msg.action) {
      const m = msg.action.match(/^a:(\d+):(\d+)$/)
      if (!m || !s.round || +m[1] !== s.round.i) return [{ text: '这道题已经答过了。发“复习”再来一轮。' }]
      return answer(chat, s, s.round.qs[s.round.i].options[+m[2]])
    }
    // 拼写题：直接回复的英文就是答案
    if (s.round && s.round.qs[s.round.i]?.kind === 'spell' && /^[a-z' -]+$/i.test(text)) return answer(chat, s, text)
    return [{ text: '没看懂。发“复习”来几道题，发“跟读”练一句，发“帮助”看全部用法。' }]
  }

  /** 每分钟调一次：到了推送时间、今天还没推过的，推一轮题 + 一句跟读 */
  async function tick(send, now = Date.now()) {
    for (const chat of store.list()) {
      const s = store.get(chat)
      if (!s) continue
      const local = new Date(now + (s.tz ?? tz) * 60_000)
      const today = dayOf(now, s.tz ?? tz)
      if (s.last === today) continue
      if (local.getUTCHours() * 60 + local.getUTCMinutes() < s.hour * 60 + s.minute) continue
      s.last = today
      save(chat, s)
      try {
        const out = [{ text: '今天的复习来了 ☀️' }, ...(await startRound(chat, store.get(chat))), ...(await startRead(chat, store.get(chat)))]
        for (const m of out) await send(chat, m)
      } catch (e) { await send(chat, { text: `今天的题没出成：${e.message || e}` }).catch(() => {}) }
    }
  }

  return { handle, tick }
}

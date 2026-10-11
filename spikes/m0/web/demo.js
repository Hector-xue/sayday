// 跟读测评演示：录音 → 16k 重采样 → Worker 推理 + GOP → 校准（0~2 分）→ 红黄绿
import { calibrate, tailNote, tailPositions, uttScore } from './calib.mjs'
const SENTENCES = [
  'I think three things are worth thanking for',
  'The weather this week is very wet and windy',
  'Light rain is right for a long walk',
  'She sells sea shells by the sea shore',
  'Mark is going to see elephant',
]
// 分档阈值在 calib.json 里（校准分 <0.8 红，<1.4 黄）：宁可漏报也不冤枉，标红的音素约 3/4 确实需要纠正
let calib = null
const HINT = {
  TH: '舌尖轻放上下齿之间送气，不要发成 s / f',
  DH: '舌尖放齿间并振动声带，不要发成 d / z',
  V: '上齿轻咬下唇并振动，不要发成 w',
  W: '双唇收圆再展开，不要咬唇',
  R: '舌尖向后卷、不碰上颚，嘴唇略圆',
  L: '舌尖抵上齿龈，气流从舌两侧出',
  N: '舌尖抵上齿龈，气流从鼻腔出',
  IY: '长音 /iː/，嘴角向两边拉开并拉长',
  IH: '短音 /ɪ/，放松、短促',
  AE: '/æ/ 嘴张大、舌位低，介于“啊”和“诶”之间',
  NG: '舌后部抵软腭，不要加 g 的爆破',
  Z: '/z/ 要振动声带，不要发成 s',
  SH: '/ʃ/ 双唇前突，舌面抬高',
  S: '/s/ 舌尖靠近上齿龈，不要卷舌',
}

const $ = (id) => document.getElementById(id)
// 听示范：预置句子播预生成的 Kokoro 音频（离线可用）；自定义句子按需在本机合成
const VOICE = { us: 'af_heart', gb: 'bf_emma' }
let accent = 'us'
try { accent = localStorage.getItem('sayday.accent') || 'us' } catch {}
let ttsIndex = {}
let ttsWorker = null
let ttsSeq = 0
const ttsPending = new Map()
let audioEl = null
const params = new URLSearchParams(location.search)
const worker = new Worker('./infer-worker.js', { type: 'module' })
let dict = null
let vocab = null
let target = null
let pending = null
const meta = { ua: navigator.userAgent, cores: navigator.hardwareConcurrency, coi: self.crossOriginIsolated }

function showMeta(extra = {}) {
  Object.assign(meta, extra)
  $('meta').textContent = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n')
}

function toPhones(text) {
  const words = (text.match(/[A-Za-z']+/g) || []).map((w) => w.toLowerCase())
  return words.map((w) => ({ word: w, phones: dict[w] ? dict[w].split(' ') : null }))
}

function setTarget(text) {
  target = { text, words: toPhones(text) }
  $('target').textContent = text
  $('phon').textContent = target.words.map((w) => (w.phones ? '/' + w.phones.join(' ').toLowerCase() + '/' : '（未收录）')).join('  ')
  for (const b of $('chips').children) b.setAttribute('aria-pressed', String(b.textContent === text))
  $('result').hidden = true
}

worker.onmessage = (e) => {
  const d = e.data
  if (d.type === 'progress' && d.total) $('status').textContent = `正在载入模型 ${Math.round((d.got / d.total) * 100)}%`
  else if (d.type === 'ready') {
    $('status').textContent = '准备好了，点“录音”开始，读完再点一次'
    $('rec').disabled = false
    showMeta({ modelCreateMs: d.createMs, threads: d.threads, modelLoadMs: Math.round(performance.now() - loadStart) })
    if (params.has('auto')) autoRun()
  } else if (d.type === 'scored' && pending) { pending.resolve(d); pending = null }
  else if (d.type === 'error') {
    $('status').textContent = '出错：' + d.error.split('\n')[0]
    if (pending) { pending.reject(new Error(d.error)); pending = null }
    window.__result = { error: d.error }
  }
}

async function decodeTo16k(blob) {
  const buf = await blob.arrayBuffer()
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const audio = await ctx.decodeAudioData(buf)
  ctx.close()
  const len = Math.ceil(audio.duration * 16000)
  const off = new OfflineAudioContext(1, len, 16000)
  const src = off.createBufferSource()
  src.buffer = audio
  src.connect(off.destination)
  src.start()
  const r = await off.startRendering()
  return r.getChannelData(0)
}

let recorder = null
let chunks = []
async function startRec() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } })
  recorder = new MediaRecorder(stream)
  chunks = []
  recorder.ondataavailable = (e) => chunks.push(e.data)
  recorder.start()
  $('rec').classList.add('on')
  $('rec').textContent = '停止'
  $('status').textContent = '正在听…'
}

function stopRec() {
  return new Promise((resolve) => {
    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop())
      $('rec').classList.remove('on')
      $('rec').textContent = '录音'
      resolve(new Blob(chunks, { type: recorder.mimeType }))
    }
    recorder.stop()
  })
}

async function evaluate(blob) {
  $('status').textContent = '正在打分…'
  const t0 = performance.now()
  const audio = await decodeTo16k(blob)
  const decodeMs = Math.round(performance.now() - t0)
  const known = target.words.filter((w) => w.phones)
  const phones = known.flatMap((w) => w.phones)
  const tailPos = tailPositions(known)
  const r = await new Promise((resolve, reject) => {
    pending = { resolve, reject }
    worker.postMessage({ type: 'score', id: 1, audio, phones, tailAt: tailPos.map((t) => t.at) }, [audio.buffer])
  })
  const seq = phones.map((p) => vocab[p])
  const scores = calibrate(calib, r.gop, seq)
  render(known, scores, tailPos, r.tails, uttScore(calib, scores, r.tails, known.length, r.T))
  const totalMs = Math.round(performance.now() - t0)
  showMeta({ audioS: r.audioS, decodeMs, inferMs: r.inferMs, gopMs: r.gopMs, totalMs })
  $('status').textContent = `用时 ${(totalMs / 1000).toFixed(1)} 秒`
  return { ...r, decodeMs, totalMs }
}

function render(words, scores, tailPos, tails, utt) {
  const { red, yellow } = calib.thresholds
  const cls = (g) => (g < red ? 'r' : g < yellow ? 'y' : 'g')
  const note = new Map()
  tails.forEach((t, i) => {
    const w = tailPos[i].word
    const last = w.phones[w.phones.length - 1].toLowerCase()
    const k = tailNote(calib, t, tailPos[i], words)
    if (k === 'ins') note.set(w, `/${last}/ 后面多了个元音`)
    else if (k === 'del') note.set(w, `尾音 /${last}/ 可能没读出来`)
  })
  let k = 0
  const bad = new Map()
  $('words').innerHTML = ''
  for (const w of words) {
    const el = document.createElement('div')
    el.className = 'w'
    const gs = w.phones.map(() => scores[k++])
    const min = Math.min(...gs)
    const tip = note.get(w)
    const wc = tip ? 'y' : cls(min) === 'g' ? '' : cls(min)
    el.innerHTML = `<b class="${wc}" style="background:none">${w.word}</b><span class="ps">${w.phones.map((p, i) => `<span class="p ${cls(gs[i])}" title="${gs[i].toFixed(2)}">${p.toLowerCase()}</span>`).join('')}</span>${tip ? `<span class="tail">${tip}</span>` : ''}`
    $('words').appendChild(el)
    w.phones.forEach((p, i) => { if (gs[i] < yellow && HINT[p]) bad.set(p, (bad.get(p) || 0) + 1) })
  }
  $('score').textContent = Math.round(utt * 10)
  $('tips').innerHTML = [...bad.keys()].slice(0, 3).map((p) => `<li><b>/${p.toLowerCase()}/</b> ${HINT[p]}</li>`).join('')
  $('result').hidden = false
}

$('rec').onclick = async () => {
  if (recorder && recorder.state === 'recording') {
    const blob = await stopRec()
    try { await evaluate(blob) } catch (e) { $('status').textContent = '出错：' + e.message }
  } else {
    try { await startRec() } catch (e) { $('status').textContent = '无法使用麦克风：' + e.message }
  }
}
function playUrl(url) {
  if (audioEl) audioEl.pause()
  audioEl = new Audio(url)
  return audioEl.play()
}

function wavUrl(samples, rate) {
  const n = samples.length
  const b = new DataView(new ArrayBuffer(44 + n * 2))
  const str = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, rate, true)
  b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true)
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }))
}

function synth(text) {
  if (!ttsWorker) {
    ttsWorker = new Worker('./tts-worker.js', { type: 'module' })
    ttsWorker.onmessage = (e) => {
      const d = e.data
      if (d.type === 'progress' && d.total) $('status').textContent = `首次使用自定义句子示范，正在下载语音模型 ${Math.round((d.got / d.total) * 100)}%（约 90MB，只下一次）`
      else if (d.type === 'audio') { ttsPending.get(d.id)?.resolve(d); ttsPending.delete(d.id) }
      else if (d.type === 'error') {
        for (const p of ttsPending.values()) p.reject(new Error(d.error))
        ttsPending.clear()
      }
    }
  }
  const id = ++ttsSeq
  return new Promise((resolve, reject) => {
    ttsPending.set(id, { resolve, reject })
    ttsWorker.postMessage({ type: 'speak', id, text, voice: VOICE[accent] })
  })
}

$('listen').onclick = async () => {
  const pre = ttsIndex[target.text.trim().toLowerCase()]
  const btn = $('listen')
  try {
    if (pre && pre[accent]) return await playUrl('./tts/samples/' + pre[accent])
    btn.disabled = true
    const keep = $('status').textContent
    $('status').textContent = '正在生成示范读音…'
    const r = await synth(target.text)
    $('status').textContent = keep
    showMeta({ ttsMs: r.ms })
    await playUrl(wavUrl(r.audio, r.rate))
  } catch (e) {
    $('status').textContent = '示范读音生成失败：' + e.message.split('\n')[0]
  } finally {
    btn.disabled = false
  }
}
for (const b of document.querySelectorAll('[data-accent]')) {
  b.setAttribute('aria-pressed', String(b.dataset.accent === accent))
  b.onclick = () => {
    accent = b.dataset.accent
    try { localStorage.setItem('sayday.accent', accent) } catch {}
    for (const x of document.querySelectorAll('[data-accent]')) x.setAttribute('aria-pressed', String(x === b))
  }
}
$('useCustom').onclick = () => { const t = $('custom').value.trim(); if (t) setTarget(t) }

async function autoRun() {
  // 自动化验证：录 params.auto 毫秒（默认 5000）后打分，结果写到 window.__result
  setTarget(params.get('text') || SENTENCES[4])
  await startRec()
  await new Promise((r) => setTimeout(r, Number(params.get('auto')) || 5000))
  const r = await evaluate(await stopRec())
  const words = [...$('words').children].map((el) => el.querySelector('b').textContent + ':' + [...el.querySelectorAll('.p')].map((p) => p.className.slice(2)).join('') + (el.querySelector('.tail') ? '(' + el.querySelector('.tail').textContent + ')' : ''))
  window.__result = { ...r, score: $('score').textContent, words, meta }
}

const loadStart = performance.now()
;(async () => {
  ;[dict, vocab, calib] = await Promise.all(['./samples/cmudict.min.json', './models/charsiu_vocab.json', './samples/calib.json'].map(async (u) => (await fetch(u)).json()))
  try {
    const idx = await (await fetch('./tts/samples/index.json')).json()
    for (const v of Object.values(idx)) ttsIndex[v.text.trim().toLowerCase()] = v
  } catch (e) { console.warn('示范音频索引载入失败', e) }
  for (const s of SENTENCES) {
    const b = document.createElement('button')
    b.className = 'chip'
    b.textContent = s
    b.onclick = () => setTarget(s)
    $('chips').appendChild(b)
  }
  setTarget(SENTENCES[0])
  showMeta()
  worker.postMessage({ type: 'load', modelUrl: './models/phone_ctc.int8.onnx' })
})()

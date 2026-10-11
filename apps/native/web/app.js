// 日日说 App（M1 验证）：原生录音 + 原生推理（onnxruntime-android）+ JS 评分（与网页版同一套 gop/calib）
import { prepare, afGop, tailLLR } from './gop.mjs'
import { calibrate, tailNote, tailPositions, uttScore, VOWELS } from './calib.mjs'

const { invoke } = window.__TAURI__.core
const $ = (id) => document.getElementById(id)
const SENTENCES = [
  'I think three things are worth thanking for',
  'The weather this week is very wet and windy',
  'Light rain is right for a long walk',
  'She sells sea shells by the sea shore',
]
let dict, vocab, calib, phoneIds, target, loadInfo
// 听示范：播放与网页版相同的预生成 Kokoro 音频（随安装包打进去，离线可用）
let accent = 'us'
try { accent = localStorage.getItem('sayday.accent') || 'us' } catch {}
let ttsIndex = {}
let audioEl = null

const toB64 = (f32) => {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (b64) => {
  const s = atob(b64)
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return new Float32Array(u8.buffer)
}
const normalize = (a) => {
  let m = 0
  for (const x of a) m += x
  m /= a.length
  let v = 0
  for (const x of a) v += (x - m) ** 2
  const sd = Math.sqrt(v / a.length + 1e-7)
  return Float32Array.from(a, (x) => (x - m) / sd)
}

async function nativeInfer(audio) {
  const t0 = performance.now()
  const r = await invoke('plugin:sayday-infer|run', { audio: toB64(normalize(audio)) })
  return { ...r, logits: fromB64(r.logits), roundTripMs: Math.round(performance.now() - t0) }
}

function setTarget(text) {
  const words = (text.match(/[A-Za-z']+/g) || []).map((w) => w.toLowerCase())
  target = { text, words: words.map((w) => ({ word: w, phones: dict[w] ? dict[w].split(' ') : null })) }
  $('target').textContent = text
  for (const b of $('chips').children) b.setAttribute('aria-pressed', String(b.textContent === text))
  $('result').hidden = true
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
  $('words').innerHTML = ''
  for (const w of words) {
    const gs = w.phones.map(() => scores[k++])
    const el = document.createElement('div')
    el.className = 'w'
    const tip = note.get(w)
    el.innerHTML = `<b>${w.word}</b><span class="ps">${w.phones.map((p, i) => `<span class="p ${cls(gs[i])}">${p.toLowerCase()}</span>`).join('')}</span>${tip ? `<span class="tail">${tip}</span>` : ''}`
    $('words').appendChild(el)
  }
  $('score').textContent = Math.round(utt * 10)
  $('result').hidden = false
}

let recording = false
$('rec').onclick = async () => {
  try {
    if (!recording) {
      await invoke('plugin:sayday-infer|record_start')
      recording = true
      $('rec').classList.add('on')
      $('rec').textContent = '停止'
      $('status').textContent = '正在听…'
      return
    }
    recording = false
    $('rec').classList.remove('on')
    $('rec').textContent = '录音'
    $('status').textContent = '正在打分…'
    const t0 = performance.now()
    const rec = await invoke('plugin:sayday-infer|record_stop')
    const audio = fromB64(rec.audio)
    const r = await nativeInfer(audio)
    const known = target.words.filter((w) => w.phones)
    const seq = known.flatMap((w) => w.phones).map((p) => vocab[p])
    const t1 = performance.now()
    const lp = prepare(r.logits, r.frames, r.vocab)
    const gop = afGop(lp, r.frames, r.vocab, seq, phoneIds)
    const scores = calibrate(calib, Array.from(gop), seq)
    const tailPos = tailPositions(known)
    const tails = tailLLR(lp, r.frames, r.vocab, seq, tailPos.map((t) => t.at), VOWELS.map((p) => vocab[p]))
    const gopMs = Math.round(performance.now() - t1)
    render(known, scores, tailPos, tails, uttScore(calib, scores, tails, known.length, r.frames))
    $('status').textContent = `${(audio.length / 16000).toFixed(1)} 秒录音 · 原生推理 ${r.inferMs} ms · 通信 ${r.roundTripMs - r.inferMs} ms · 评分 ${gopMs} ms · 共 ${Math.round(performance.now() - t0)} ms`
  } catch (e) {
    recording = false
    $('rec').classList.remove('on')
    $('rec').textContent = '录音'
    $('status').textContent = '出错：' + e
  }
}

$('bench').onclick = async () => {
  $('bench').disabled = true
  $('rec').disabled = true
  const out = $('benchOut')
  const lines = [`设备：${loadInfo.device} · ${loadInfo.cores} 核`, `首次拷贝模型 ${loadInfo.copyMs} ms`]
  out.textContent = lines.join('\n') + '\n测速中…'
  try {
    const meta = await (await fetch('./samples/meta.json')).json()
    const samples = await Promise.all(meta.map(async (m) => ({
      ...m,
      x: new Float32Array(await (await fetch(`./samples/u${m.i}.f32`)).arrayBuffer()),
      ref: new Float32Array(await (await fetch(`./samples/u${m.i}.ref.f32`)).arrayBuffer()),
    })))
    for (const threads of [1, 2, 4]) {
      const ld = await invoke('plugin:sayday-infer|load_model', { threads })
      // 样本已归一化，直接送原生；先热身一次
      await invoke('plugin:sayday-infer|run', { audio: toB64(samples[0].x) })
      let rtf = 0, agree = 1, ipc = 0
      for (const s of samples) {
        const t0 = performance.now()
        const r = await invoke('plugin:sayday-infer|run', { audio: toB64(s.x) })
        ipc += performance.now() - t0 - r.inferMs
        rtf += r.inferMs / 1000 / (s.samples / 16000)
        const lg = fromB64(r.logits)
        let same = 0
        for (let f = 0; f < s.frames; f++) {
          let a = 0, b = 0
          for (let v = 1; v < s.vocab; v++) {
            if (lg[f * s.vocab + v] > lg[f * s.vocab + a]) a = v
            if (s.ref[f * s.vocab + v] > s.ref[f * s.vocab + b]) b = v
          }
          if (a === b) same++
        }
        agree = Math.min(agree, same / s.frames)
      }
      rtf /= samples.length
      lines.push(`${threads} 线程：每 1 秒音频 ${rtf.toFixed(3)} 秒（3 秒句子约 ${(rtf * 3 * 1000).toFixed(0)} ms）· 建会话 ${ld.createMs} ms · 通信均值 ${Math.round(ipc / samples.length)} ms · 与参考帧一致 ${(agree * 100).toFixed(1)}%`)
      out.textContent = lines.join('\n') + '\n测速中…'
    }
    await invoke('plugin:sayday-infer|load_model', { threads: 4 })
    out.textContent = lines.join('\n') + '\n完成，截图发回即可'
  } catch (e) {
    out.textContent = lines.join('\n') + '\n出错：' + e
  }
  $('bench').disabled = false
  $('rec').disabled = false
}

;(async () => {
  try {
    ;[dict, vocab, calib] = await Promise.all(['./samples/cmudict.min.json', './samples/charsiu_vocab.json', './samples/calib.json'].map(async (u) => (await fetch(u)).json()))
    phoneIds = Object.entries(vocab).filter(([k]) => !k.startsWith('[')).map(([, id]) => id)
    for (const s of SENTENCES) {
      const b = document.createElement('button')
      b.className = 'chip'
      b.textContent = s
      b.onclick = () => setTarget(s)
      $('chips').appendChild(b)
    }
    setTarget(SENTENCES[0])
    try {
      for (const v of Object.values(await (await fetch('./tts/samples/index.json')).json())) ttsIndex[v.text.trim().toLowerCase()] = v
    } catch (e) { console.warn('示范音频索引载入失败', e) }
    loadInfo = await invoke('plugin:sayday-infer|load_model', { threads: 4 })
    $('status').textContent = `准备好了（${loadInfo.device}），点“录音”开始，读完再点一次`
    $('rec').disabled = false
    $('bench').disabled = false
  } catch (e) {
    $('status').textContent = '启动失败：' + e
  }
})()

$('listen').onclick = () => {
  const v = ttsIndex[target.text.trim().toLowerCase()]
  if (!v || !v[accent]) { $('status').textContent = '这句还没有示范读音'; return }
  if (audioEl) audioEl.pause()
  audioEl = new Audio('./tts/samples/' + v[accent])
  audioEl.play().catch((e) => { $('status').textContent = '播放失败：' + e.message })
}
for (const b of document.querySelectorAll('[data-accent]')) {
  b.setAttribute('aria-pressed', String(b.dataset.accent === accent))
  b.onclick = () => {
    accent = b.dataset.accent
    try { localStorage.setItem('sayday.accent', accent) } catch {}
    for (const x of document.querySelectorAll('[data-accent]')) x.setAttribute('aria-pressed', String(x === b))
  }
}

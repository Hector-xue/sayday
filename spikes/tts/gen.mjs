// 用 Kokoro-82M 预生成示范句音频（16-bit 单声道 WAV, 24kHz），供跟读页“听示范”直接播放、离线可用。
// 用法: DTYPE=fp32|q8 node gen.mjs <输出目录> "句子1" "句子2" ...
// 文件名 = <voice>-<句子哈希>.wav；同时写 index.json（句子 → 文件）
import { KokoroTTS } from 'kokoro-js'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [out, ...sentences] = process.argv.slice(2)
const VOICES = { us: 'af_heart', gb: 'bf_emma' }
mkdirSync(out, { recursive: true })

export const key = (s) => createHash('sha1').update(s.trim().toLowerCase()).digest('hex').slice(0, 10)

function wav16(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  return b
}

const t0 = Date.now()
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: process.env.DTYPE || 'fp32', device: 'cpu' })
console.error(`载入 ${Date.now() - t0} ms`)
const index = {}
for (const s of sentences) {
  index[key(s)] = { text: s }
  for (const [accent, voice] of Object.entries(VOICES)) {
    const t = Date.now()
    const a = await tts.generate(s, { voice, speed: 0.95 })
    const f = `${accent}-${key(s)}.wav`
    writeFileSync(join(out, f), wav16(a.audio, a.sampling_rate))
    index[key(s)][accent] = f
    console.error(`${f} ${(a.audio.length / a.sampling_rate).toFixed(2)}s 用时 ${Date.now() - t} ms  ${s}`)
  }
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1))

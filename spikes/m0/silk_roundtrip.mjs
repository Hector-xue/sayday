// 用微信同款 SILK v3 编解码走一遍：node silk_roundtrip.mjs in.pcm out.pcm <采样率>
// 输入/输出均为单声道 pcm_s16le。打印 silk 字节数与码率，供估算微信语音音质损失。
import { readFileSync, writeFileSync } from 'node:fs'
import { encode, decode } from 'silk-wasm'

const [src, dst, sr] = process.argv.slice(2)
const pcm = readFileSync(src)
const enc = await encode(pcm, Number(sr))
const dec = await decode(enc.data, Number(sr))
writeFileSync(dst, dec.data)
process.stdout.write(JSON.stringify({ silkBytes: enc.data.length, ms: enc.duration, kbps: +(enc.data.length * 8 / enc.duration).toFixed(1) }))

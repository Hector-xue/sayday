// 聊天里收到的语音 → 16kHz 单声道 float32。Telegram / 飞书的语音都是 Ogg/Opus（本机没有 ffmpeg，用 wasm 解码）；
// 其他格式（wav、微信 silk）交给 packages/agent 的解码
import { OggOpusDecoder } from 'ogg-opus-decoder'

let agent = null
export const agentCore = async () => (agent ??= await import('../agent/core.mjs'))

export async function decode(buf) {
  if (buf.toString('latin1', 0, 4) === 'OggS') {
    const d = new OggOpusDecoder()
    await d.ready
    try {
      const { channelData, sampleRate } = await d.decodeFile(new Uint8Array(buf))
      if (!channelData?.[0]?.length) throw new Error('语音是空的')
      return (await agentCore()).resample(channelData[0], sampleRate)
    } finally { d.free() }
  }
  return (await agentCore()).decodeAudio(buf)
}

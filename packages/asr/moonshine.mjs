// 离线语音识别（Moonshine，MIT）：编码器 + 带 KV 缓存的解码器，贪心解码。
// 只依赖传进来的 onnxruntime（网页 onnxruntime-web / Node onnxruntime-node 同一套接口），不带 transformers.js：
// 后者要再打包一份约 20MB 的推理 wasm，App 里已经有一份了。
//
// 解码器是 “merged” 导出：第一步 use_cache_branch=false（过去为空），之后 =true，
// 解码端的 KV 每步换成上一步的 present，编码端的 KV 用第一步算出来的那份。

const LAYERS = 8, HEADS = 8, HEAD_DIM = 52
const BOS = 1, EOS = 2

/** 模型最多能说多少个 token：按每秒 6.5 个估（Moonshine 官方的上限） */
const maxTokens = (samples) => Math.max(8, Math.ceil((samples / 16000) * 6.5))

export async function transcribe(ort, enc, dec, audio, vocab) {
  const { last_hidden_state: hidden } = await enc.run({ input_values: new ort.Tensor('float32', audio, [1, audio.length]) })
  const empty = () => new ort.Tensor('float32', new Float32Array(0), [1, HEADS, 0, HEAD_DIM])
  const past = {}
  for (let l = 0; l < LAYERS; l++) for (const a of ['decoder', 'encoder']) for (const kv of ['key', 'value']) past[`past_key_values.${l}.${a}.${kv}`] = empty()
  const ids = []
  let token = BOS
  for (let step = 0; step < maxTokens(audio.length); step++) {
    const out = await dec.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from([BigInt(token)]), [1, 1]),
      encoder_hidden_states: hidden,
      use_cache_branch: new ort.Tensor('bool', Uint8Array.from([step > 0 ? 1 : 0]), [1]),
      ...past,
    })
    const logits = out.logits.data
    const V = out.logits.dims[2]
    let best = 0, bv = -Infinity
    for (let v = 0; v < V; v++) if (logits[v] > bv) { bv = logits[v]; best = v }
    for (let l = 0; l < LAYERS; l++) for (const kv of ['key', 'value']) {
      past[`past_key_values.${l}.decoder.${kv}`] = out[`present.${l}.decoder.${kv}`]
      if (step === 0) past[`past_key_values.${l}.encoder.${kv}`] = out[`present.${l}.encoder.${kv}`]
    }
    if (best === EOS) break
    ids.push(best)
    token = best
  }
  return detokenize(ids, vocab)
}

/** SentencePiece 风格：▁ 是空格，<0xNN> 是字节（按 UTF-8 拼回去），特殊符号跳过 */
export function detokenize(ids, vocab) {
  const bytes = []
  const enc = new TextEncoder()
  for (const id of ids) {
    const t = vocab[id]
    if (t === undefined || id < 3 || /^<<.*>>$/.test(t)) continue
    const m = /^<0x([0-9A-Fa-f]{2})>$/.exec(t)
    if (m) bytes.push(parseInt(m[1], 16))
    else bytes.push(...enc.encode(t.replace(/▁/g, ' ')))
  }
  return new TextDecoder().decode(new Uint8Array(bytes)).replace(/^ /, '').trim()
}

// AI 层（方案第 4 节）：用户自带 API，直接从设备调用（各家接口都允许跨域，实测过），不经过我们的服务器
// 只让用户选服务商 + 贴密钥；地址、模型自动定（模型从 /models 列表里按偏好挑），手工改的收在“高级”里
import { kvGet, kvSet } from './db'

export type Kind = 'openai' | 'anthropic'
export type Provider = { id: string; name: string; base: string; kind: Kind; prefer: RegExp[]; fallback: string; keyUrl?: string; noKey?: boolean; note?: string }

export const PROVIDERS: Provider[] = [
  { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com', kind: 'openai', prefer: [/^deepseek-chat$/], fallback: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'qwen', name: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', kind: 'openai', prefer: [/^qwen-plus$/, /^qwen-plus-latest$/, /^qwen-turbo$/], fallback: 'qwen-plus', keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1' },
  { id: 'kimi', name: 'Kimi', base: 'https://api.moonshot.cn/v1', kind: 'openai', prefer: [/^kimi-k\d+(\.\d+)?$/, /^kimi-latest$/, /^moonshot-v1-8k$/], fallback: 'kimi-latest', keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'glm', name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', kind: 'openai', prefer: [/^glm-4\.\d+-flash$/, /^glm-4-flash/, /^glm-4-plus$/], fallback: 'glm-4-flash', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'siliconflow', name: '硅基流动', base: 'https://api.siliconflow.cn/v1', kind: 'openai', prefer: [/^deepseek-ai\/DeepSeek-V3$/, /^Qwen\/Qwen2\.5-72B-Instruct$/], fallback: 'deepseek-ai/DeepSeek-V3', keyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', kind: 'openai', prefer: [/^gpt-4\.1-mini$/, /^gpt-4o-mini$/], fallback: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Claude', base: 'https://api.anthropic.com', kind: 'anthropic', prefer: [/haiku/, /sonnet/], fallback: 'claude-haiku-4-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', kind: 'openai', prefer: [/^deepseek\/deepseek-chat/, /^openai\/gpt-4o-mini$/], fallback: 'deepseek/deepseek-chat', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'ollama', name: '本机 Ollama', base: 'http://localhost:11434/v1', kind: 'openai', prefer: [/qwen/, /llama/], fallback: 'qwen2.5:7b', noKey: true, note: '要先设置 OLLAMA_ORIGINS=* 再启动 Ollama。Chrome 会拦截网页访问本机地址，网页版连不上就请用其他服务商' },
  { id: 'custom', name: '其他（OpenAI 兼容）', base: '', kind: 'openai', prefer: [], fallback: '' },
]
export const providerOf = (id: string) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]

export type AiConfig = { provider: string; key: string; base?: string; model?: string; checked?: number }
export const getAi = () => kvGet<AiConfig | null>('ai', null)
export const saveAi = (c: AiConfig | null) => kvSet('ai', c)

/** 密钥长得像哪家：sk-ant- 是 Claude，sk-or- 是 OpenRouter；别的 sk- 分不出来 */
export function guessProvider(key: string): string | null {
  if (key.startsWith('sk-ant-')) return 'anthropic'
  if (key.startsWith('sk-or-')) return 'openrouter'
  return null
}

export function pickModel(p: Provider, ids: string[]): string {
  for (const re of p.prefer) { const hit = ids.filter((x) => re.test(x)).sort().reverse()[0]; if (hit) return hit }
  return ids.includes(p.fallback) ? p.fallback : p.fallback || ids[0] || ''
}

export class AiError extends Error {
  constructor(public kind: 'key' | 'money' | 'model' | 'net' | 'rate' | 'server' | 'format' | 'none', msg: string) { super(msg) }
}

/** 把各家的报错归成用户能看懂、知道下一步做什么的几类 */
function classify(status: number, body: string): AiError {
  const b = body.slice(0, 300)
  if (status === 401 || status === 403) return new AiError('key', '密钥不对或已失效。去服务商后台复制一个新的再贴进来')
  if (status === 402 || /insufficient|balance|余额|quota|arrear/i.test(b)) return new AiError('money', '账户余额不足。去服务商后台充值后再试')
  if (status === 404 || /model.*(not|does not)|模型/i.test(b)) return new AiError('model', '这个模型用不了。到“高级”里换一个模型，或者重新连接让它自动挑')
  if (status === 429) return new AiError('rate', '请求太频繁或额度用完了，过一会儿再试')
  return new AiError('server', `服务商返回错误 ${status}：${b || '无详情'}`)
}

const endpoint = (c: AiConfig) => (c.base || providerOf(c.provider).base).replace(/\/+$/, '')

async function call(c: AiConfig, path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const p = providerOf(c.provider)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (p.kind === 'anthropic') Object.assign(headers, { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' })
  else if (c.key) headers.authorization = `Bearer ${c.key}`
  if (c.provider === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://sayday.ivyea.com', 'X-Title': 'Sayday' })
  let r: Response
  try {
    r = await fetch(endpoint(c) + path, { ...init, headers, signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new AiError('net', p.id === 'ollama' ? '连不上本机 Ollama：确认它在运行，并且设置了 OLLAMA_ORIGINS=*' : '连不上服务商：检查网络；如果填了自定义地址，确认地址没写错')
  }
  if (!r.ok) throw classify(r.status, await r.text().catch(() => ''))
  return r
}

export async function listModels(c: AiConfig): Promise<string[]> {
  const p = providerOf(c.provider)
  const r = await call(c, p.kind === 'anthropic' ? '/v1/models' : '/models', { method: 'GET' })
  const j = await r.json()
  return ((j.data ?? j.models ?? []) as any[]).map((m) => m.id ?? m.name).filter(Boolean)
}

export type Msg = { role: 'user' | 'assistant'; content: string }
export type Opts = { system?: string; messages: Msg[]; maxTokens?: number; temperature?: number; onDelta?: (text: string) => void; signal?: AbortSignal }

/** 对话补全；给了 onDelta 就流式（边出边显示），返回完整文本 */
export async function complete(c: AiConfig, o: Opts): Promise<string> {
  const p = providerOf(c.provider)
  const model = c.model || p.fallback
  const stream = !!o.onDelta
  let body: object, path: string
  if (p.kind === 'anthropic') {
    path = '/v1/messages'
    body = { model, max_tokens: o.maxTokens ?? 800, temperature: o.temperature ?? 0.7, system: o.system, messages: o.messages, stream }
  } else {
    path = '/chat/completions'
    body = { model, max_tokens: o.maxTokens ?? 800, temperature: o.temperature ?? 0.7, stream, messages: [...(o.system ? [{ role: 'system', content: o.system }] : []), ...o.messages] }
  }
  const r = await call(c, path, { method: 'POST', body: JSON.stringify(body) }, o.signal)
  if (!stream) {
    const j = await r.json()
    const text = p.kind === 'anthropic' ? (j.content ?? []).map((b: any) => b.text ?? '').join('') : j.choices?.[0]?.message?.content ?? ''
    if (!text) throw new AiError('none', '模型没有返回内容，再试一次')
    return text
  }
  // SSE：data: {...}\n\n
  const reader = r.body!.getReader()
  const dec = new TextDecoder()
  let buf = '', out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const j = JSON.parse(data)
        const d = p.kind === 'anthropic' ? (j.type === 'content_block_delta' ? j.delta?.text ?? '' : '') : j.choices?.[0]?.delta?.content ?? ''
        if (d) { out += d; o.onDelta!(out) }
      } catch { /* 心跳等非 JSON 行 */ }
    }
  }
  if (!out) throw new AiError('none', '模型没有返回内容，再试一次')
  return out
}

/** 要 JSON 的场景：从回复里抠出第一个 {...}；解析失败就带着错误重问一次（护栏：结构不对不往下用） */
export async function completeJson<T>(c: AiConfig, o: Opts, check: (x: any) => x is T): Promise<T> {
  const tryParse = (t: string) => {
    const m = t.match(/\{[\s\S]*\}/)
    if (!m) return null
    try { const x = JSON.parse(m[0]); return check(x) ? x : null } catch { return null }
  }
  const t1 = await complete(c, { ...o, temperature: o.temperature ?? 0.3 })
  const x1 = tryParse(t1)
  if (x1) return x1
  const t2 = await complete(c, { ...o, temperature: 0.1, messages: [...o.messages, { role: 'assistant', content: t1 }, { role: 'user', content: 'Your last reply was not valid JSON in the required format. Reply again with ONLY the JSON object, nothing else.' }] })
  const x2 = tryParse(t2)
  if (x2) return x2
  throw new AiError('format', 'AI 返回的格式不对，换个模型可能会好（高级里可以改）')
}

/** 连接测试：列模型（顺带挑一个）+ 真问一句，两步都过才算连上 */
export async function connect(c: AiConfig): Promise<AiConfig> {
  const p = providerOf(c.provider)
  let model = c.model
  if (!model) {
    try { model = pickModel(p, await listModels(c)) } catch (e) {
      // 有的服务商不开放模型列表：密钥错要直接报，其他情况用默认模型继续试
      if (e instanceof AiError && (e.kind === 'key' || e.kind === 'net' || e.kind === 'money')) throw e
      model = p.fallback
    }
  }
  if (!model) throw new AiError('model', '没找到能用的模型，请在“高级”里填模型名')
  const cfg = { ...c, model }
  const t = await complete(cfg, { messages: [{ role: 'user', content: 'Reply with just: OK' }], maxTokens: 10, temperature: 0 })
  if (!t.trim()) throw new AiError('none', '模型没有回应')
  return { ...cfg, checked: Date.now() }
}

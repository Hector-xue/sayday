#!/usr/bin/env node
// sayday-agent：把日日说的能力交给你在用的 AI 助手（方案 14.1 的四层接入，前三层在这里）
//   sayday-agent mcp              本地 MCP（stdio）：Codex、Claude Code、WorkBuddy 等
//   sayday-agent http [端口]       远程 MCP（Streamable HTTP，/mcp）+ HTTP API（POST /api/<工具名>）+ /openapi.json
//                                 要设 SAYDAY_TOKEN，请求带 Authorization: Bearer <token>；只绑 127.0.0.1，公网请走反向代理
//   sayday-agent gen              重新生成 skill/SKILL.md 和 openapi.json（都来自 tools.mjs）
//   sayday-agent call <工具> '<JSON 参数>'   命令行直接调（Skill 脚本就用这个）
import { createServer } from 'node:http'
import { writeFileSync, mkdirSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { TOOLS, toolByName } from './tools.mjs'

const VERSION = '0.0.4'
const here = new URL('./', import.meta.url).pathname

async function runTool(name, args) {
  const t = toolByName.get(name)
  if (!t) throw new Error(`没有这个工具：${name}`)
  return t.run(args ?? {})
}

function mcpServer() {
  const s = new Server({ name: 'sayday', version: VERSION }, { capabilities: { tools: {} }, instructions: '日日说（英语学习）工具：发音打分、语音转文字、查词、例句、按水平选词、雅思口语题、剧集台词。用户发英文语音时优先用 score_pronunciation 给反馈。' })
  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.input })) }))
  s.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const out = await runTool(req.params.name, req.params.arguments)
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out }
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: String(e?.message || e) }] }
    }
  })
  return s
}

export function openapi() {
  return {
    openapi: '3.1.0',
    info: { title: '日日说 Sayday 工具 API', version: VERSION, description: '和 MCP 工具同一套定义。请求头 Authorization: Bearer <SAYDAY_TOKEN>' },
    paths: Object.fromEntries(TOOLS.map((t) => [`/api/${t.name}`, { post: { summary: t.title, description: t.description, operationId: t.name, requestBody: { required: true, content: { 'application/json': { schema: t.input } } }, responses: { 200: { description: '结果（JSON）' }, 400: { description: '参数或处理出错，body.error 是中文原因' } } } }])),
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearer: [] }],
  }
}

function skillMd() {
  const rows = TOOLS.map((t) => `### ${t.name}（${t.title}）\n${t.description}\n\n参数：\n${Object.entries(t.input.properties).map(([k, v]) => `- \`${k}\`${t.input.required?.includes(k) ? '（必填）' : ''}：${v.description ?? (v.enum ? v.enum.join(' / ') : v.type)}`).join('\n')}\n\n调用：\`sayday-agent call ${t.name} '{${(t.input.required ?? []).map((k) => `"${k}": …`).join(', ')}}'\``).join('\n\n')
  return `---
name: sayday-english-coach
description: 英语学习教练（日日说）。用户发英文语音、问单词、想练口语或要每日单词时使用：给发音逐词打分并指出错在哪个音、查词和例句、按水平选词、出雅思口语题、陪读剧集。
---

# 日日说 · 英语教练

## 什么时候用
- 用户发来**英文语音**（跟读或自由说）：先 \`score_pronunciation\`（有原文就带上 text），再用中文简短反馈：总分一句话 → 最多 3 个读错的词和改法 → 一句鼓励。不要把 JSON 原样贴给用户。
- 用户问某个词：\`lookup_word\`，再给一句例句。
- 用户说“今天学什么”“给我几个词”：\`daily_words\`（不知道水平就先问一句，或默认 B1）。
- 用户想练口语 / 雅思：\`speaking_question\` 出题 → 用户用语音回答 → \`transcribe\` + \`score_pronunciation\` → 按流利、词汇、语法、发音给建议。
- 用户想看剧、分角色练：\`episode\`。

## 原则
- 反馈用中文，例句和改正用英文；一次只纠最重要的 1~3 处，别满屏红。
- 工具说听不清 / 没识别出内容时，如实告诉用户，**不要编分数**。
- 如果你拿不到用户的原始录音（只拿到了转写文字），就说明“这边只收到文字，发音打分请用日日说 App”，不要假装打了分。

## 工具
${rows}
`
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'mcp') {
  await mcpServer().connect(new StdioServerTransport())
} else if (cmd === 'http') {
  const port = Number(rest[0] || process.env.PORT || 8790)
  const token = process.env.SAYDAY_TOKEN
  if (!token || token.length < 16) { console.error('请先设置 SAYDAY_TOKEN（至少 16 位）'); process.exit(1) }
  const authed = (req) => {
    const got = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''))
    const want = Buffer.from(token)
    return got.length === want.length && timingSafeEqual(got, want)
  }
  const body = (req) => new Promise((res, rej) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 40e6) rej(new Error('请求太大')) }); req.on('end', () => res(b)); req.on('error', rej) })
  createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
    try {
      if (req.url === '/openapi.json') return send(200, openapi())
      if (req.url === '/health') return send(200, { ok: true, version: VERSION })
      if (!authed(req)) return send(401, { error: '缺少或错误的 Token' })
      if (req.url === '/mcp') {
        // 无状态模式：每个请求一个新的 server + transport
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        const s = mcpServer()
        res.on('close', () => { transport.close(); s.close() })
        await s.connect(transport)
        const raw = req.method === 'POST' ? await body(req) : ''
        return transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined)
      }
      const m = /^\/api\/([a-z_]+)$/.exec(req.url ?? '')
      if (m && req.method === 'POST') {
        try { return send(200, await runTool(m[1], JSON.parse((await body(req)) || '{}'))) } catch (e) { return send(400, { error: String(e?.message || e) }) }
      }
      send(404, { error: '没有这个路径' })
    } catch (e) {
      if (!res.headersSent) send(500, { error: String(e?.message || e) })
    }
  }).listen(port, '127.0.0.1', () => console.error(`sayday-agent http 127.0.0.1:${port}（/mcp、/api/<工具>、/openapi.json）`))
} else if (cmd === 'gen') {
  mkdirSync(here + 'skill', { recursive: true })
  writeFileSync(here + 'skill/SKILL.md', skillMd())
  writeFileSync(here + 'openapi.json', JSON.stringify(openapi(), null, 2) + '\n')
  console.log('已生成 skill/SKILL.md、openapi.json')
} else if (cmd === 'call') {
  const out = await runTool(rest[0], rest[1] ? JSON.parse(rest[1]) : {})
  console.log(JSON.stringify(out, null, 1))
} else {
  console.log('用法：sayday-agent mcp | http [端口] | gen | call <工具> <JSON>')
}

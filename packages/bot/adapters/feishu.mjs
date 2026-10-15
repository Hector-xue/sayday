// 飞书：收消息（im.message.receive_v1）和卡片按钮（card.action.trigger）两种方式，二选一：
//   长连接（默认，没配 FEISHU_VERIFY_TOKEN 时）：机器人主动连飞书，不需要公网回调地址，后台“事件与回调”选“使用长连接接收”
//   回调地址（配了 FEISHU_VERIFY_TOKEN）：飞书 POST 到本机 HTTP 服务（nginx 转发 /api/bot/feishu），用 Verification Token 校验；不支持 Encrypt Key
// 发消息都走开放平台接口；按钮用消息卡片，语音是 opus
import http from 'node:http'
import * as lark from '@larksuiteoapi/node-sdk'

export function feishu({ appId, appSecret, verifyToken, base = 'https://open.feishu.cn', port = 5299, onMessage, log = console.log }) {
  let tok = null, exp = 0
  async function token() {
    if (tok && Date.now() < exp) return tok
    const r = await (await fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }) })).json()
    if (r.code !== 0) throw new Error(`飞书拿 token 失败：${r.msg}`)
    tok = r.tenant_access_token; exp = Date.now() + (r.expire - 120) * 1000
    return tok
  }
  async function api(path, init = {}) {
    const r = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${await token()}`, 'content-type': 'application/json; charset=utf-8' } })
    return r
  }
  async function send(chat, m) {
    const id = chat.replace(/^fs:/, '')
    const card = { config: { wide_screen_mode: true }, elements: [{ tag: 'div', text: { tag: 'lark_md', content: m.text } }, ...(m.buttons?.length ? [{ tag: 'action', actions: m.buttons.map((b) => ({ tag: 'button', text: { tag: 'plain_text', content: b.label }, type: 'default', value: { data: b.data } })) }] : [])] }
    const body = m.buttons?.length ? { receive_id: id, msg_type: 'interactive', content: JSON.stringify(card) } : { receive_id: id, msg_type: 'text', content: JSON.stringify({ text: m.text }) }
    const r = await (await api('/open-apis/im/v1/messages?receive_id_type=chat_id', { method: 'POST', body: JSON.stringify(body) })).json()
    if (r.code !== 0) throw new Error(`飞书发消息失败：${r.msg}`)
  }
  async function download(messageId, fileKey) {
    const r = await api(`/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`)
    if (!r.ok) throw new Error(`下载语音失败：${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  const seen = new Set()
  /** 把飞书事件转成 { chat, msg }；不是要处理的事件返回 null */
  function parse(body) {
    const t = body.header?.event_type, e = body.event
    if (t === 'im.message.receive_v1') {
      const m = e.message
      const chat = `fs:${m.chat_id}`
      const c = JSON.parse(m.content || '{}')
      if (m.message_type === 'audio') return { chat, msg: { voice: () => download(m.message_id, c.file_key) } }
      if (m.message_type === 'text') return { chat, msg: { text: String(c.text ?? '').replace(/@_user_\d+\s*/g, '').trim() } }
      return null
    }
    if (t === 'card.action.trigger') return { chat: `fs:${e.context?.open_chat_id}`, msg: { action: e.action?.value?.data } }
    return null
  }
  function handler(req, res) {
    let raw = ''
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy() })
    req.on('end', async () => {
      let body
      try { body = JSON.parse(raw) } catch { res.writeHead(400); return res.end() }
      if (body.encrypt) { res.writeHead(400); return res.end('不支持 Encrypt Key，请在飞书后台清空加密策略') }
      if (body.type === 'url_verification') {
        if (body.token !== verifyToken) { res.writeHead(403); return res.end() }
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ challenge: body.challenge }))
      }
      if (body.header?.token !== verifyToken) { res.writeHead(403); return res.end() }
      // 飞书 3 秒内要回 200，处理放后台；同一事件可能重发，按 event_id 去重
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}')
      const d = parse(body)
      if (!d) return
      const id = body.header?.event_id
      if (id) { if (seen.has(id)) return; seen.add(id); if (seen.size > 5000) seen.clear() }
      try { for (const r of await onMessage(d.chat, d.msg)) await send(d.chat, r) } catch (e) { log('飞书处理出错', e); await send(d.chat, { text: '出错了，稍后再试' }).catch(() => {}) }
    })
  }
  async function dispatch(type, event, id) {
    if (id) { if (seen.has(id)) return; seen.add(id); if (seen.size > 5000) seen.clear() }
    const d = parse({ header: { event_type: type }, event })
    if (!d) return
    try { for (const r of await onMessage(d.chat, d.msg)) await send(d.chat, r) } catch (e) { log('飞书处理出错', e); await send(d.chat, { text: '出错了，稍后再试' }).catch(() => {}) }
  }
  /** 长连接：SDK 负责连飞书、心跳、重连；事件来了交给 dispatch（不等它处理完，飞书要求尽快确认） */
  function startWs() {
    const ws = new lark.WSClient({ appId, appSecret, loggerLevel: lark.LoggerLevel.warn })
    const ed = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (e) => { dispatch('im.message.receive_v1', e, e?.message?.message_id) },
      'card.action.trigger': async (e) => { dispatch('card.action.trigger', e, e?.event_id ?? e?.token); return {} },
    })
    ws.start({ eventDispatcher: ed })
    return () => ws.close?.()
  }
  return {
    send, parse, handler, dispatch,
    start: () => {
      if (!verifyToken) { log('飞书：长连接模式'); return startWs() }
      log('飞书：回调地址模式'); const srv = http.createServer(handler).listen(port, '127.0.0.1'); return () => srv.close()
    },
  }
}

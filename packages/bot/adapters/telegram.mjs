// Telegram：长轮询收消息（不用公网回调地址），按钮用 inline keyboard，语音是 Ogg/Opus
export function telegram({ token, base = 'https://api.telegram.org', onMessage, log = console.log }) {
  const call = async (method, body) => {
    const r = await fetch(`${base}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    const j = await r.json().catch(() => ({}))
    if (!j.ok) throw new Error(`Telegram ${method}：${j.description ?? r.status}`)
    return j.result
  }
  async function send(chat, m) {
    const id = chat.replace(/^tg:/, '')
    const body = { chat_id: id, text: m.text }
    if (m.buttons?.length) body.reply_markup = { inline_keyboard: m.buttons.map((b) => [{ text: b.label, callback_data: b.data }]) }
    await call('sendMessage', body)
  }
  async function download(fileId) {
    const f = await call('getFile', { file_id: fileId })
    const r = await fetch(`${base}/file/bot${token}/${f.file_path}`)
    if (!r.ok) throw new Error(`下载语音失败：${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  async function dispatch(u) {
    if (u.callback_query) {
      const q = u.callback_query
      await call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {})
      return { chat: `tg:${q.message.chat.id}`, msg: { action: q.data } }
    }
    const m = u.message
    if (!m) return null
    const chat = `tg:${m.chat.id}`
    if (m.voice || m.audio) { const id = (m.voice ?? m.audio).file_id; return { chat, msg: { voice: () => download(id) } } }
    if (m.text) return { chat, msg: { text: m.text } }
    return null
  }
  let stop = false, offset = 0
  async function loop() {
    while (!stop) {
      try {
        const us = await call('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] })
        for (const u of us) {
          offset = u.update_id + 1
          const d = await dispatch(u)
          if (!d) continue
          try { for (const r of await onMessage(d.chat, d.msg)) await send(d.chat, r) } catch (e) { log('telegram 处理出错', e); await send(d.chat, { text: '出错了，稍后再试' }).catch(() => {}) }
        }
      } catch (e) { log('telegram 轮询出错', e.message ?? e); await new Promise((r) => setTimeout(r, 5000)) }
    }
  }
  return { send, start: () => { loop(); return () => { stop = true } }, dispatch }
}

// 后台：词表放这里（页面里每次都载 2MB 太浪费），回答内容脚本的查词、存收的词。
// 收的词只存在浏览器里；在弹窗里导出成文件，App 里“导入备份”选它就合进去（不经过任何服务器）
import { lookup } from './lib.js'

let words = null
const loadWords = async () => (words ??= await (await fetch(chrome.runtime.getURL('words.json'))).json())

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 'lookup') return reply(lookup(await loadWords(), msg.word))
    if (msg.type === 'save') {
      const { clips = {} } = await chrome.storage.local.get('clips')
      clips[msg.word] = { s: msg.s, url: msg.url, title: msg.title, ts: Date.now() }
      await chrome.storage.local.set({ clips })
      reply({ ok: true, n: Object.keys(clips).length })
      return
    }
    if (msg.type === 'has') { const { clips = {} } = await chrome.storage.local.get('clips'); return reply(!!clips[msg.word]) }
  })()
  return true
})

import { validCode } from './crypto.js'
const $ = (id) => document.getElementById(id)
const { clips = {}, code = '', last } = await chrome.storage.local.get(['clips', 'code', 'last'])
const list = Object.entries(clips).sort((a, b) => b[1].ts - a[1].ts)
$('empty').hidden = list.length > 0
for (const [w, c] of list) {
  const li = document.createElement('li')
  li.innerHTML = '<b></b><span class="s"></span>'
  li.querySelector('b').textContent = w
  li.querySelector('.s').textContent = c.s
  $('list').appendChild(li)
}
$('code').value = code
$('st').textContent = last ? (last.error ? `上次失败：${last.error}` : `${new Date(last.ts).toLocaleString()} 同步过`) : ''
$('sync').addEventListener('click', async () => {
  const v = $('code').value.trim()
  if (!validCode(v)) { $('st').textContent = '同步码不对，再核对一下'; return }
  await chrome.storage.local.set({ code: v })
  $('st').textContent = '同步中…'
  const r = await chrome.runtime.sendMessage({ type: 'sync' })
  $('st').textContent = r.ok ? `同步好了，共 ${list.length} 个词` : r.error
})

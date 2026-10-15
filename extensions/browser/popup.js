import { exportFile } from './lib.js'
const $ = (id) => document.getElementById(id)
const { clips = {}, dev: dev0 } = await chrome.storage.local.get(['clips', 'dev'])
const list = Object.entries(clips).sort((a, b) => b[1].ts - a[1].ts)
$('empty').hidden = list.length > 0
$('export').disabled = !list.length
for (const [w, c] of list) {
  const li = document.createElement('li')
  li.innerHTML = '<b></b><span class="s"></span>'
  li.querySelector('b').textContent = w
  li.querySelector('.s').textContent = c.s
  $('list').appendChild(li)
}
// 导出成文件：App 设置 → 导入备份 选它，合进词库（不经过任何服务器）
$('export').addEventListener('click', async () => {
  let dev = dev0
  if (!dev) { dev = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join(''); await chrome.storage.local.set({ dev }) }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(exportFile(dev, clips))], { type: 'application/json' }))
  a.download = `sayday-收词-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  $('st').textContent = `已导出 ${list.length} 个词`
})

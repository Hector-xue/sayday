// 页面里：双击或选中一个英文单词，旁边弹一张小卡片（音标、释义、“收进日日说”）。卡片放在 Shadow DOM 里，不受网页样式影响
(() => {
  let host = null
  const close = () => { host?.remove(); host = null }
  const sentence = (sel) => {
    const node = sel.anchorNode
    const block = node && (node.nodeType === 3 ? node.parentElement : node)?.closest('p,li,td,dd,blockquote,h1,h2,h3,h4,div,span')
    const text = (block ?? node?.parentElement)?.innerText ?? ''
    const w = sel.toString().trim()
    const i = text.indexOf(w)
    // 和 lib.mjs 的 sentenceAround 一样的切法（内容脚本不能用 import）
    const t = text.replace(/\s+/g, ' ')
    const off = Math.max(0, t.indexOf(w, Math.max(0, i - 5)))
    const before = t.slice(0, off), after = t.slice(off)
    const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! '))
    const m = after.match(/[.?!](\s|$)/)
    let s = t.slice(start < 0 ? 0 : start + 2, m ? off + m.index + 1 : t.length).trim()
    if (s.length > 240) s = s.slice(Math.max(0, off - (start + 2) - 120), off - (start + 2) + 120).trim() + '…'
    return s
  }
  async function show() {
    const sel = getSelection()
    const word = sel?.toString().trim()
    if (!word || !/^[A-Za-z][A-Za-z'-]{1,29}$/.test(word)) return
    const hit = await chrome.runtime.sendMessage({ type: 'lookup', word }).catch(() => null)
    if (!hit) return
    const has = await chrome.runtime.sendMessage({ type: 'has', word: hit.w }).catch(() => false)
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    close()
    host = document.createElement('div')
    host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0'
    const root = host.attachShadow({ mode: 'open' })
    const zh = String(hit.zh).split(/[；;]/).slice(0, 2).join('；')
    root.innerHTML = `<style>
      .c{font:14px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#fff;color:#16181d;border:1px solid #e3e1da;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:10px 12px;width:260px}
      b{font-size:17px} .ipa{color:#8a8f98;margin-left:6px} .zh{margin:4px 0 8px;color:#4a4f57}
      button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;background:#ffe14d;color:#16181d}
      button[disabled]{background:#eee;color:#8a8f98;cursor:default} .s{color:#8a8f98;font-size:12px;margin-left:8px}
      @media (prefers-color-scheme: dark){.c{background:#22252b;color:#f1f1f1;border-color:#3a3d44}.zh{color:#c9ccd2}}
    </style><div class="c"><b></b><span class="ipa"></span><div class="zh"></div><button></button><span class="s"></span></div>`
    root.querySelector('b').textContent = hit.w
    root.querySelector('.ipa').textContent = hit.ipa ? `/${hit.ipa}/` : ''
    root.querySelector('.zh').textContent = zh
    const btn = root.querySelector('button'), st = root.querySelector('.s')
    btn.textContent = has ? '已经收过了' : '收进日日说'
    btn.disabled = has
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const r = await chrome.runtime.sendMessage({ type: 'save', word: hit.w, s: sentence(sel), url: location.href, title: document.title })
      btn.textContent = '收好了'; btn.disabled = true; st.textContent = `共 ${r.n} 个`
    })
    document.documentElement.appendChild(host)
    const left = Math.min(Math.max(8, rect.left), innerWidth - 276), top = rect.bottom + 8 + 120 > innerHeight ? rect.top - 128 : rect.bottom + 8
    host.style.left = left + 'px'; host.style.top = top + 'px'
  }
  document.addEventListener('dblclick', () => setTimeout(show, 0))
  document.addEventListener('mouseup', (e) => { if (host && e.composedPath().includes(host)) return; setTimeout(() => { if (!getSelection()?.toString().trim()) close(); else show() }, 0) })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
  addEventListener('scroll', close, { passive: true })
})()

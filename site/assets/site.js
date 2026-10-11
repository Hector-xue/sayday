// 日日说门户：顶栏、下载链接（读 /download/version.json）、进场动画、示范播放器
;(function () {
  document.documentElement.classList.add('js')
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches

  // 顶栏：离开页首后加底色
  const nav = document.getElementById('nav')
  let ticking = false
  const sync = () => { ticking = false; nav.classList.toggle('scrolled', window.scrollY > 16) }
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(sync) } }, { passive: true })
  sync()

  // 下载：默认 GitHub（version.json 顶层），“换本站线路”切到 mirror
  fetch('/download/version.json', { cache: 'no-store' }).then((r) => r.json()).then((v) => {
    document.querySelectorAll('[data-ver]').forEach((e) => { e.textContent = 'v' + v.version })
    const set = (sel, t) => { const e = document.querySelector(sel); if (e) e.textContent = t }
    if (v.published_at) set('[data-date]', '· ' + v.published_at.slice(0, 10))
    if (v.prerelease) set('[data-pre]', ' · 预发布')
    if (v.android_arm64_size) set('[data-size]', '· ' + Math.round(v.android_arm64_size / 1048576) + 'MB')
    set('[data-notes]', (v.notes || '').replace(/\*\*/g, '').replace(/`/g, ''))
    const links = (src) => document.querySelectorAll('[data-dl]').forEach((a) => { const u = src[a.dataset.dl]; if (u) a.href = u })
    links(v)
    const m = v.mirror || {}
    const tip = document.querySelector('.mirror-tip')
    const sw = document.querySelector('[data-mirror]')
    let on = false
    if (tip && sw && Object.values(m).some(Boolean)) {
      tip.hidden = false
      sw.addEventListener('click', (e) => {
        e.preventDefault()
        on = !on
        links(on ? m : v)
        tip.firstChild.textContent = on ? '已换成本站线路。' : '下载慢或打不开？'
        sw.textContent = on ? '换回 GitHub' : '换本站线路'
      })
    }
  }).catch(() => {})

  // 进场 + 音标逐个上色
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return
    io.unobserve(e.target)
    if (e.target.matches('[data-chips]')) colorChips(e.target)
    else e.target.classList.add('in')
  }), { threshold: 0.15 })
  document.querySelectorAll('.reveal, [data-chips]').forEach((el) => io.observe(el))

  function colorChips(box) {
    const chips = [...box.querySelectorAll('.w i')]
    if (reduce) { box.classList.add('in'); return }
    // 先全灰，再从左到右逐个“判分”
    chips.forEach((c) => { c.dataset.k = c.className; c.className = '' })
    box.classList.add('in')
    chips.forEach((c, i) => setTimeout(() => { c.className = c.dataset.k }, 300 + i * 70))
  }

  // 示范播放器：波形 = 这段音频的真实振幅（peaks.json），播放时按进度点亮
  let peaks = {}
  let current = null
  const BASE = '/assets/audio/'
  fetch(BASE + 'peaks.json').then((r) => r.json()).then((p) => { peaks = p; document.querySelectorAll('[data-player]').forEach(drawWave) }).catch(() => {})

  function drawWave(pl) {
    const w = pl.querySelector('[data-wave]')
    const ps = peaks[pl.dataset.player] || []
    w.innerHTML = ps.map((v) => `<i style="height:${Math.max(12, Math.round(v * 100))}%"></i>`).join('')
  }

  function stop() {
    if (!current) return
    current.audio.pause()
    current.btn.classList.remove('on')
    current.bars.forEach((b) => b.classList.remove('done'))
    cancelAnimationFrame(current.raf)
    current = null
  }

  document.querySelectorAll('[data-player]').forEach((pl) => {
    const btn = pl.querySelector('.play')
    btn.addEventListener('click', () => {
      const same = current && current.pl === pl
      stop()
      if (same) return
      const audio = new Audio(BASE + pl.dataset.player + '.wav')
      const bars = [...pl.querySelectorAll('.wave i')]
      current = { pl, btn, audio, bars, raf: 0 }
      btn.classList.add('on')
      const tick = () => {
        if (!current || current.audio !== audio) return
        const f = audio.duration ? audio.currentTime / audio.duration : 0
        const n = Math.round(f * bars.length)
        bars.forEach((b, i) => b.classList.toggle('done', i < n))
        current.raf = requestAnimationFrame(tick)
      }
      audio.addEventListener('ended', stop)
      audio.play().then(tick).catch(stop)
    })
  })

  // 口音切换：换同一句的另一份音频
  document.querySelectorAll('.voice-card').forEach((card) => {
    const pl = card.querySelector('[data-player]')
    const us = pl.dataset.player
    const gb = pl.dataset.alt
    card.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => {
      card.querySelectorAll('[data-acc]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      const was = current && current.pl === pl
      stop()
      pl.dataset.player = b.dataset.acc === 'gb' ? gb : us
      drawWave(pl)
      if (was) pl.querySelector('.play').click()
    }))
  })
})()

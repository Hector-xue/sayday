// 网页版：发音模型（约 120MB）在后台提前下进离线缓存，第一次跟读不用干等。
// 今天页：打开几秒后自动开始，只在下载中显示一条进度；设置页：显示状态，可手动下载
import { useEffect, useState } from 'react'
import { isNative, modelCached, modelCacheStatus, onModelCache, prefetchModel, type ModelCache } from '../lib/speech/engine'

const mb = (n?: number) => `${Math.round((n ?? 0) / 1048576)}MB`

function useModelCache() {
  const [m, setM] = useState<ModelCache>(modelCacheStatus())
  useEffect(() => {
    const off = onModelCache(setM)
    if (modelCacheStatus().state === 'idle') modelCached().then((ok) => { if (ok) setM({ state: 'cached' }) })
    return off
  }, [])
  return m
}

/** 今天页的进度条：自动开始，下载中才显示 */
export function ModelPrefetchBar() {
  const m = useModelCache()
  useEffect(() => {
    if (isNative) return
    const t = setTimeout(() => { prefetchModel(true) }, 3000)
    return () => clearTimeout(t)
  }, [])
  if (isNative || m.state !== 'downloading') return null
  const pct = m.total ? Math.round(((m.got ?? 0) / m.total) * 100) : null
  return (
    <div className="model-dl" role="status">
      <p className="small muted">正在后台下载发音模型{pct !== null ? ` ${pct}%` : ` ${mb(m.got)}`} · 下完跟读打分不用等，也能离线用</p>
      <div className="bar"><i style={{ width: `${pct ?? 5}%` }} /></div>
    </div>
  )
}

/** 设置页的一行 */
export function ModelPrefetchRow() {
  const m = useModelCache()
  if (isNative) return null
  const pct = m.total ? Math.round(((m.got ?? 0) / m.total) * 100) : 0
  const text = { idle: '约 120MB，跟读打分要用；下好后能离线', cached: '已下载，可离线跟读打分', downloading: `下载中 ${pct}%（${mb(m.got)} / ${mb(m.total)}）`, error: '没下完，再点一次接着下', unsupported: '这个浏览器存不住离线文件，跟读时现下' }[m.state]
  return (
    <div className="set-row">
      <div className="k"><b>发音模型</b><span>{text}</span></div>
      {(m.state === 'idle' || m.state === 'error') && <button className="btn small quiet" onClick={() => prefetchModel(false)}>下载</button>}
    </div>
  )
}

// 设置页“数据”里的同步：
//   面对面同步（默认，App 才有）：同一个 Wi-Fi 下两台设备直接传；
//   自建同步服务器（收在“高级”里，给自己部署了 packages/sync-server 的人，聊天机器人也要它）：
//     没开 → 填服务器地址开启 / 用同步码加入；开了 → 同步码、立即同步、退出
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { kvGet, kvSet } from '../lib/db'
import { disableSync, enableSync, getSync, getSyncState, normServer, syncNow, validCode, type SyncCfg, type SyncState } from '../lib/sync'
import { canLan, lastLanSync } from '../lib/lan'
import { LanSyncPage } from './LanSync'

const ago = (ts: number) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前` }

export function SyncRows() {
  const [lan, setLan] = useState(false)
  const [last, setLast] = useState(0)
  const [retired, setRetired] = useState(false)
  const [cfg, setCfg] = useState<SyncCfg | null | undefined>(undefined)
  const [adv, setAdv] = useState(false)
  useEffect(() => {
    lastLanSync().then(setLast)
    // getSync 会把旧版连 sayday.ivyea.com 的配置关掉并记下 sync_retired
    getSync().then((c) => { setCfg(c); kvGet<boolean>('sync_retired', false).then(setRetired) })
  }, [])
  const openLan = () => { setLan(true); if (retired) { setRetired(false); kvSet('sync_retired', false) } }
  return (
    <>
      {canLan() ? (
        <div className="set-row">
          <div className="k"><b>面对面同步</b><span>{retired ? '原来的同步码同步已经停了，本机记录都在。以后换这个：' : ''}{last ? `上次 ${ago(last)}。` : ''}两台设备连同一个 Wi-Fi，扫一下码就合到一起，不经过任何服务器</span></div>
          <button className="btn small quiet" onClick={openLan}>开始</button>
        </div>
      ) : (
        <div className="set-row"><div className="k"><b>换设备</b><span>{retired ? '原来的同步码同步已经停了，本机记录都在。' : ''}网页版用下面的导出 / 导入备份；装了 App 的两台设备可以面对面同步</span></div></div>
      )}
      {cfg ? <ServerRows cfg={cfg} reload={() => getSync().then(setCfg)} /> : cfg === null && (
        adv ? <ServerSetup reload={() => getSync().then(setCfg)} /> : (
          <div className="set-row"><div className="k"><b>自建同步服务器</b><span>高级：自己部署了同步服务（聊天机器人要用）才需要</span></div><button className="btn small quiet" onClick={() => setAdv(true)}>设置</button></div>
        )
      )}
      {lan && <LanSyncPage onClose={() => { setLan(false); lastLanSync().then(setLast) }} />}
    </>
  )
}

function ServerSetup({ reload }: { reload: () => void }) {
  const { toast } = useApp()
  const [server, setServer] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = /^https?:\/\/[^\s/]+/.test(normServer(server))
  const run = async (join: boolean) => {
    setBusy(true)
    try {
      await enableSync(server, join ? code : undefined)
      try { await syncNow() } catch (e) { await disableSync(); throw e }
      if (join) { toast('已接上，正在载入'); setTimeout(() => location.reload(), 600) } else toast('已开启，同步码在下面，抄到别的设备上')
    } catch (e) { toast((e as Error).message || String(e)) } finally { setBusy(false); reload() }
  }
  return (
    <div className="set-row sync-join" style={{ display: 'grid', gap: 8 }}>
      <div className="k"><b>自建同步服务器</b><span>部署方法见项目里的 docs/机器人.md。服务器只存加密后的数据</span></div>
      <input className="input en" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://你的域名/api/sync" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <input className="input sync-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="已有同步码就填上（第一台设备留空）" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
      <button className="btn small primary" disabled={busy || !ok || (!!code && !validCode(code))} onClick={() => run(!!code)}>{busy ? '连接中…' : code ? '用同步码接上' : '开启'}</button>
    </div>
  )
}

function ServerRows({ cfg, reload }: { cfg: SyncCfg; reload: () => void }) {
  const { toast, refresh } = useApp()
  const [st, setSt] = useState<SyncState | null>(null)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = () => { reload(); getSyncState().then(setSt) }
  useEffect(() => { getSyncState().then(setSt) }, [])
  const run = async (f: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try { await f(); if (ok) toast(ok) } catch (e) { toast((e as Error).message || String(e)) } finally { setBusy(false); load(); refresh() }
  }
  return (
    <>
      <div className="set-row">
        <div className="k"><b>服务器同步</b><span>{st?.error ? `上次失败：${st.error}` : st?.last ? `${ago(st.last)}同步过 · 共 ${st.devices} 台设备` : '还没同步过'}</span></div>
        <button className="btn small quiet" disabled={busy} onClick={() => run(syncNow, '同步好了')}>{busy ? '同步中…' : '立即同步'}</button>
      </div>
      <div className="set-row">
        <div className="k"><b>同步码</b><span className={show ? 'en sync-code-show' : ''}>{show ? cfg.code : `服务器 ${cfg.server}。在别的设备上输入同步码就能接上，别发给别人`}</span></div>
        <button className="btn small quiet" onClick={async () => { if (!show) { setShow(true); return } try { await navigator.clipboard.writeText(cfg.code); toast('已复制') } catch { toast('复制不了，手动抄一下') } }}>{show ? '复制' : '显示'}</button>
      </div>
      <div className="set-row">
        <div className="k"><b>这台设备退出服务器同步</b><span>本机的学习记录留着</span></div>
        <button className="btn small quiet" onClick={() => { if (confirm('这台设备退出服务器同步？')) run(disableSync, '已退出') }}>退出</button>
      </div>
    </>
  )
}

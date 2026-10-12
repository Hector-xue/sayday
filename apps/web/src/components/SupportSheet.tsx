// 支持日日说：¥1，自觉制。App 里一键“存码去扫”，网页上直接给二维码用手机微信扫
import { useState } from 'react'
import { useApp } from '../store'
import { isNative } from '../lib/speech/engine'
import { markSupporter, snoozeSupport, SUPPORT, wechatViaGallery, type SupportState } from '../lib/support'
import { Sheet } from './Sheet'

export function SupportSheet({ state, prompted, onChange, onClose }: { state: SupportState; prompted?: boolean; onChange: (s: SupportState) => void; onClose: () => void }) {
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  const [showQr, setShowQr] = useState(!isNative)
  const supporter = !!state.since

  const wechat = async () => {
    setBusy(true)
    try {
      const r = await wechatViaGallery()
      toast(r === 'opened' ? '收款码已存到相册，扫一扫里点右上角相册选它' : '收款码已存到相册。打开微信 → 扫一扫 → 右上角相册，选它')
    } catch {
      setShowQr(true)
      toast('没能存进相册，截图这张码再去微信扫')
    } finally { setBusy(false) }
  }
  const confirm = async () => {
    if (!window.confirm('确认后“支持日日说”的提醒不再出现。')) return
    onChange(await markSupporter())
    toast('谢谢你的支持')
    onClose()
  }
  const later = async () => {
    onChange(await snoozeSupport())
    onClose()
  }

  return (
    <Sheet onClose={onClose} className="support">
      <div className="support-price"><b>{SUPPORT.amount}</b><span>一杯白开水的钱</span></div>
      <p className="support-text">
        {supporter
          ? `你在 ${state.since} 支持过日日说。谢谢——你的支持是我持续更新的动力，也是对这个项目的认可。`
          : '日日说是一个人写的：开源、没有广告、学习记录不出手机。你的支持是我持续更新的动力，也是对这个项目的认可。付一块钱，这条提醒永久关掉；不付也一样用，功能不差一分。'}
      </p>
      {isNative && <button className="btn quiet block" disabled={busy} onClick={wechat}>{busy ? '正在保存…' : '微信 · 存码去扫'}</button>}
      {showQr && (
        <figure className="support-qr">
          <img src={new URL('support/wechat.svg', document.baseURI).href} alt="微信收款码" width={176} height={176} />
          <figcaption className="small muted">{isNative ? '截图后在微信「扫一扫 → 相册」里选它' : '用手机微信扫'}</figcaption>
        </figure>
      )}
      {!supporter && <button className="btn primary block" style={{ marginTop: 10 }} onClick={confirm}>我已支持，永久关闭</button>}
      {!supporter && prompted && <button className="btn ghost block" style={{ marginTop: 6, border: 0 }} onClick={later}>先不了，{SUPPORT.snoozeDays} 天后再说</button>}
      <p className="small faint" style={{ marginTop: 12 }}>这一页不联网、不上报，付没付只有你自己知道。</p>
    </Sheet>
  )
}

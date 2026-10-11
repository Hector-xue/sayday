// 全屏弹层（练习、发音实验室、AI 聊天、日记共用）
// 挂到 body：页面容器有进场动画（transform），fixed 定位会被它困住、被底栏盖住
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'

export function Overlay({ title, sub, onClose, children, foot, right }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; right?: ReactNode }) {
  return createPortal(
    <div className="session">
      <div className="session-top">
        <button className="icon-btn" onClick={onClose} aria-label="关闭"><Icon.close /></button>
        <div style={{ flex: 1, minWidth: 0 }}><b>{title}</b>{sub && <div className="small muted ellipsis">{sub}</div>}</div>
        {right}
      </div>
      <div className="session-body">{children}</div>
      {foot && <div className="session-foot">{foot}</div>}
    </div>,
    document.body,
  )
}

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** 底部弹出的面板。挂到 body 上：页面的进场动画会形成层叠上下文，挂在页面里会被底栏盖住 */
export function Sheet({ onClose, className, children }: { onClose: () => void; className?: string; children: ReactNode }) {
  return createPortal(
    <div className="sheet-mask" onClick={onClose}>
      <div className={`sheet fade-in${className ? ' ' + className : ''}`} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  )
}

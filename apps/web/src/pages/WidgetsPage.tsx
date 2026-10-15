// 桌面小组件（参照余见）：列出六种小组件——用你现在的真实数据画预览，看到的就是放到桌面上的样子；
// 每种一个“添加到桌面”（系统弹确认框），桌面不支持的给手动加的办法
import { useEffect, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { useApp } from '../store'
import { WIDGET_KINDS, widgetData, type WidgetData, type WidgetKind } from '../lib/widget'
import { pinWidget, systemStatus, type SystemStatus } from '../lib/system'

/** 预览按桌面格子等比画：一格约 72px */
const CELL = 72

function Preview({ kind, d }: { kind: WidgetKind; d: WidgetData }) {
  const w = d.words[0]
  const btn = d.done ? '再来一组' : d.practiced ? '继续' : '开练'
  if (kind === 'week') return (
    <div className="wg wg-week">
      <div className="wg-row"><span className="wg-chip">{d.head}</span><span className="wg-faint">{d.week.streak > 1 ? `连续 ${d.week.streak} 周` : ''}</span></div>
      <div className="wg-days">{d.week.days.map((x) => <span key={x.d}><i>{x.d}</i><b className={`${x.lit ? 'on' : ''} ${x.today ? 'today' : ''}`}>{x.lit ? '✓' : ''}</b></span>)}</div>
      <div className="wg-row"><span><b className="wg-main">{d.main}</b><br /><span className="wg-soft">{!d.done && d.week.lit < d.week.goal ? `再练 ${d.week.goal - d.week.lit} 天本周达标` : d.sub}</span></span><span className="wg-btn">{btn}</span></div>
    </div>
  )
  if (kind === 'today') return (
    <div className="wg wg-today">
      <div><b className="wg-big">{d.week.lit}</b><span className="wg-faint">/{d.week.goal}</span></div>
      <span className="wg-soft">{d.week.met ? '本周达标' : '本周练了几天'}</span>
      <b className="wg-main">{d.main}</b>
      <span className="wg-btn">{btn}</span>
    </div>
  )
  if (kind === 'word') return (
    <div className="wg wg-word">
      <div className="wg-row"><span><b className="wg-mark en">{w?.w ?? 'word'}</b>{w?.ipa && <span className="wg-faint"> /{w.ipa}/</span>}</span>{d.words.length > 1 && <span className="wg-btn soft">换一个</span>}</div>
      <b className="wg-main sm">{w?.zh ?? '学几个词，这里会出现在学的词'}</b>
      {w?.ex && <span className="wg-soft clamp en">{w.ex}<br />{w.exZh}</span>}
    </div>
  )
  if (kind === 'episode') return (
    <div className="wg wg-ep">
      <div className="wg-row"><span className="wg-faint">{d.ep?.label ?? '今日剧集'}</span><span className="wg-btn">{d.ep?.ready === false ? '明天解锁' : '去看'}</span></div>
      <b className="wg-title en">{d.ep?.title ?? 'Life in London'}</b>
      <span className="wg-soft clamp">{d.ep?.zh ?? '一天一集，像追剧一样学英语'}</span>
    </div>
  )
  if (kind === 'mini') return (
    <div className="wg-mini"><b>{d.practiced ? '✓' : '练'}</b><span>本周 {d.week.lit}/{d.week.goal}</span></div>
  )
  return (
    <div className="wg wg-classic">
      <span className="wg-chip">{d.head}</span>
      <b className="wg-main">{d.main}</b>
      <span className="wg-soft">{d.sub}</span>
      {w && <span><b className="wg-mark sm en">{w.w}</b> <span className="wg-faint">{w.zh}</span></span>}
    </div>
  )
}

export function WidgetsPage({ onClose }: { onClose: () => void }) {
  const { toast } = useApp()
  const [d, setD] = useState<WidgetData | null>(null)
  const [sys, setSys] = useState<SystemStatus | null>(null)
  const native = !!(globalThis as any).__TAURI__
  useEffect(() => { widgetData().then(setD); systemStatus().then(setSys) }, [])
  const pin = async (kind: WidgetKind) => {
    if (await pinWidget(kind)) toast('在弹出的窗口里点“添加”。没弹的话：长按桌面空白处 → 小组件 → 日日说')
    else toast('这个桌面不支持从 App 里添加：长按桌面空白处 → 小组件（或“添加工具”）→ 找到日日说，拖到桌面')
    setTimeout(() => systemStatus().then(setSys), 4000)
  }
  return (
    <Overlay title="桌面小组件" sub={sys?.widgets ? `桌面上已有 ${sys.widgets} 个` : '不打开 App 也能看到今天练没练'} onClose={onClose}>
      <div className="fade-in widgets-page">
        <p className="small muted">{native ? (sys?.canPin === false ? '这个桌面不支持从 App 里添加：长按桌面空白处 → 小组件 → 日日说，拖到桌面。' : '点“添加到桌面”，系统会弹确认框；也可以长按桌面空白处 → 小组件 → 日日说。内容练完会自动更新。') : '小组件只有安卓 App 有，下面是它们的样子。'}</p>
        {d && WIDGET_KINDS.map((k) => (
          <div className="card wk" key={k.kind}>
            <div className="row">
              <b>{k.name}</b><span className="wk-size">{k.cols}×{k.rows}</span>
              {(sys?.kinds?.[k.kind] ?? 0) > 0 && <span className="small muted">已放 {sys!.kinds![k.kind]} 个</span>}
              <div className="spacer" />
              {native && sys?.canPin !== false && <button className="btn small quiet" onClick={() => pin(k.kind)}>添加到桌面</button>}
            </div>
            <p className="small muted">{k.desc}</p>
            <div className="wk-frame" style={{ width: CELL * k.cols, height: CELL * k.rows }}>
              <Preview kind={k.kind} d={d} />
            </div>
          </div>
        ))}
      </div>
    </Overlay>
  )
}

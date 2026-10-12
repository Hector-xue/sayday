// 支持日日说：¥1，自觉制。付款走微信收款码（App 里存进相册再拉起扫一扫，网页上直接给码用手机扫）；
// 「我已支持」一点永久关提醒，不付也一样用。整个功能不联网、不上报，状态只存在本机（kv 'support'，随备份走）。
import { kvGet, kvSet, today } from './db'

export const SUPPORT = {
  amount: '¥1',
  /** 微信个人收款码的内容；public/support/wechat.png / .svg 就是它画出来的（换码要一起重画） */
  wechatQr: 'wxp://f2f03Pb3FgIFbhpbb-FXdFJGRW9QaZ2wZVDfmkTwZLyPnhQ',
  /** 提醒出现的门槛：练满这么多天（有练习的天数，不要求连续）。先让人尝到甜头再提 */
  minDays: 14,
  /** 「30 天后再说」 */
  snoozeDays: 30,
}

export type SupportState = { since?: string; snoozeUntil?: number }

export const getSupport = () => kvGet<SupportState>('support', {})

/** 今天页要不要出那张小卡：没支持过、练满门槛天数、不在“以后再说”期间 */
export function shouldPrompt(s: SupportState, days: number, now = Date.now()): boolean {
  if (s.since) return false
  if (days < SUPPORT.minDays) return false
  return !s.snoozeUntil || now >= s.snoozeUntil
}

export async function markSupporter(): Promise<SupportState> {
  const s = { ...(await getSupport()), since: today() }
  await kvSet('support', s)
  return s
}

export async function snoozeSupport(now = Date.now()): Promise<SupportState> {
  const s = { ...(await getSupport()), snoozeUntil: now + SUPPORT.snoozeDays * 86400_000 }
  await kvSet('support', s)
  return s
}

const tauri = (globalThis as any).__TAURI__?.core as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined

/**
 * App 里：把收款码存进相册，再拉起微信扫一扫（微信没有个人收款码的直达协议，只能从相册选图）。
 * 返回 'opened' 已拉起微信 / 'saved' 存好了但没打开微信（没装或被拦）；存不进相册抛错，调用方改为展示二维码让人截图。
 */
export async function wechatViaGallery(): Promise<'opened' | 'saved'> {
  if (!tauri) throw new Error('只在 App 里可用')
  const buf = new Uint8Array(await (await fetch(new URL('support/wechat.png', document.baseURI))).arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000) as unknown as number[])
  await tauri.invoke('plugin:sayday-infer|save_image', { name: `sayday-support-${Date.now()}.png`, data: btoa(bin) })
  try {
    const r = await tauri.invoke('plugin:sayday-infer|open_url', { url: 'weixin://scanqrcode' })
    return r?.ok ? 'opened' : 'saved'
  } catch {
    return 'saved'
  }
}

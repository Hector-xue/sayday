// 线性图标（24px 网格，描边 1.8）
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
export const Icon = {
  today: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  words: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 5a2 2 0 012-2h11a1 1 0 011 1v15H6a2 2 0 00-2 2V5z" /><path d="M4 19a2 2 0 012-2h12v4H6a2 2 0 01-2-2zM8 7h6M8 10h4" /></svg>,
  progress: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  settings: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>,
  play: () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.5.86l11-6.5a1 1 0 000-1.72l-11-6.5A1 1 0 008 5.5z" /></svg>,
  stop: () => <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>,
  mic: () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z" /></svg>,
  close: () => <svg viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  check: () => <svg viewBox="0 0 24 24" {...P} strokeWidth={2.4}><path d="M5 12.5l4.5 4.5L19 7" /></svg>,
  review: () => <svg viewBox="0 0 24 24" {...P}><path d="M3 12a9 9 0 1015.5-6.3L21 8" /><path d="M21 3v5h-5" /></svg>,
  plus: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 5v14M5 12h14" /></svg>,
  ear: () => <svg viewBox="0 0 24 24" {...P}><path d="M6 9a6 6 0 1112 0c0 3-2 4-3 5.5S14 18 12 20a3 3 0 01-4-1" /><path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-1.5 2-1.5 3" /></svg>,
  slow: () => <svg viewBox="0 0 24 24" {...P}><path d="M3 17h13a4 4 0 004-4 4 4 0 00-4-4h-1.5A4.5 4.5 0 006 9.5V12" /><circle cx="18" cy="13" r=".8" fill="currentColor" /></svg>,
}

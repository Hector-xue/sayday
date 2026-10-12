import { createRoot } from 'react-dom/client'
import './styles/app.css'
import './styles/marker.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)

// 离线：注册 Service Worker（App 外壳里不需要；开发模式不注册）
if ('serviceWorker' in navigator && import.meta.env.PROD && !(globalThis as any).__TAURI__) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}

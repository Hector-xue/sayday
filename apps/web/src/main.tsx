import { isShell } from './lib/speech/engine'
import { createRoot } from 'react-dom/client'
import './styles/app.css'
import './styles/marker.css'
import './styles/paper.css'
import { App } from './App'
import { initNativeChrome } from './lib/native-chrome'

initNativeChrome()

createRoot(document.getElementById('root')!).render(<App />)

// 离线：注册 Service Worker（App 外壳里——安卓、桌面版——不需要；开发模式不注册）
if ('serviceWorker' in navigator && import.meta.env.PROD && !isShell) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}

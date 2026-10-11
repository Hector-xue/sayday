import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { appendFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// 构建后列出 dist 里的全部文件，写成 precache.json 给 Service Worker 用。
// 音素模型（122MB）与 Kokoro 语音模型除外：首次用到时再缓存，不拖慢首次打开
function precacheManifest(): Plugin {
  let dist = ''
  return {
    name: 'sayday-precache',
    apply: 'build',
    // 输出目录以实际配置为准（App 构建会用 --outDir 指到 apps/native/dist）
    configResolved(c) { dist = resolve(c.root, c.build.outDir) },
    closeBundle() {
      const files: string[] = []
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f)
          if (statSync(p).isDirectory()) walk(p)
          else files.push(relative(dist, p).split('\\').join('/'))
        }
      }
      walk(dist)
      const skip = (f: string) => f === 'sw.js' || f === 'precache.json' || f.endsWith('.onnx') || f.endsWith('.map') || /^tts\/(onnx-community|lib|ort)\//.test(f)
      const list = files.filter((f) => !skip(f)).sort()
      const version = Date.now()
      writeFileSync(join(dist, 'precache.json'), JSON.stringify({ version, files: list }))
      // sw.js 内容不变浏览器就不会更新它：每次构建在末尾写上版本号
      if (existsSync(join(dist, 'sw.js'))) appendFileSync(join(dist, 'sw.js'), `\n// build ${version}\n`)
    },
  }
}

export default defineConfig({
  // 相对路径：同一份产物既能挂在 sayday.ivyea.com/app/ 下，也能直接塞进 Tauri
  base: './',
  plugins: [react(), precacheManifest()],
  resolve: { alias: { '@speech': join(__dirname, '../../packages/speech'), '@asr': join(__dirname, '../../packages/asr') } },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm', 'onnxruntime-web'] },
  worker: { format: 'es' },
  server: { fs: { allow: ['../..'] } },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1500 },
})

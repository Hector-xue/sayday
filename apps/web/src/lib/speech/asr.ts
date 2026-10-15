// 语音转文字（和 Emma 说话、说日记、口语练习）：全在本机，录音不上传
import { isShell } from './engine'

export type AsrStatus = { state: 'idle' | 'loading' | 'ready' | 'error'; got?: number; total?: number; error?: string }
let status: AsrStatus = { state: 'idle' }
const listeners = new Set<(s: AsrStatus) => void>()
const set = (s: AsrStatus) => { status = s; listeners.forEach((f) => f(s)) }
export const asrStatus = () => status
export function onAsrStatus(f: (s: AsrStatus) => void) { listeners.add(f); return () => { listeners.delete(f) } }

// 模型放在门户的公开目录（App 里跨域取；目录名带版本，换模型时改这里）
const BASE = (isShell ? 'https://sayday.ivyea.com' : location.origin) + '/asr/moonshine-base-q8/'
export const ASR_MB = 63

let worker: Worker | null = null
let loading: Promise<void> | null = null
let seq = 0
const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>()

export function ensureAsr(): Promise<void> {
  if (loading) return loading
  set({ state: 'loading' })
  worker = new Worker(new URL('./asr-worker.ts', import.meta.url), { type: 'module' })
  loading = new Promise<void>((resolve, reject) => {
    worker!.onmessage = (e) => {
      const d = e.data
      if (d.type === 'progress') set({ state: 'loading', got: d.got, total: d.total })
      else if (d.type === 'ready') { set({ state: 'ready' }); resolve() }
      else if (d.type === 'result') { pending.get(d.id)?.resolve(d.text); pending.delete(d.id) }
      else if (d.type === 'error') {
        if (d.id && pending.has(d.id)) { pending.get(d.id)!.reject(new Error(d.error)); pending.delete(d.id) }
        else reject(new Error(d.error))
      }
    }
    worker!.postMessage({ type: 'load', base: BASE, wasmBase: new URL('ort/', new URL('./', location.href)).href })
  })
  loading = loading.catch((e) => { set({ state: 'error', error: String(e?.message || e) }); worker?.terminate(); worker = null; loading = null; throw e })
  return loading
}

/** 模型是不是已经在本机了（决定要不要先提示下载） */
export async function asrCached(): Promise<boolean> {
  try { return !!(await (await caches.open('sayday-asr-v1')).match(BASE + 'decoder.onnx')) } catch { return false }
}

export async function transcribe(audio16k: Float32Array): Promise<string> {
  await ensureAsr()
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ type: 'run', id, audio: audio16k })
  })
}

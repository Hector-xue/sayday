// 听学的中文讲解要念的全部中文：每个词的释义（整理成“名词，市场。”）+ 每条例句的译文，去重。
// 文件名（键）= zhKey(念的字)，和 App 里算的是同一个函数（apps/web/src/lib/gloss.ts，Node 22 直接去类型运行），字对得上才找得到。
// 用法: node zh_items.mjs --shard 0 --shards 24 --out items.json [--have have.txt] [--limit 20]
//   have.txt：线上已有清单（每行 zh/<键>），增量时跳过已有的
// 输出 [{ key, text, say }]：text 是 App 念的原文（键按它算），say 是交给合成的（把“Tom”换成“汤姆”这类中文模型念不好的）
import { readFileSync, writeFileSync } from 'node:fs'
import { glossParts, glossSpeech, zhKey } from '../../apps/web/src/lib/gloss.ts'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const shard = Number(arg('shard', 0))
const shards = Number(arg('shards', 1))
const limit = Number(arg('limit', 0))
const have = new Set(arg('have', '') ? readFileSync(arg('have', ''), 'utf8').split('\n').filter(Boolean) : [])
const pack = new URL('../pack/', import.meta.url)
const words = JSON.parse(readFileSync(new URL('words.json', pack)))
const sents = JSON.parse(readFileSync(new URL('sentences.json', pack)))

/** 交给合成的写法：例句译文里夹着的英文人名换成中文译名（中文模型遇到英文要么跳过要么念成字母） */
export const speakable = (t) => t.replace(/\bTom\b/gi, '汤姆').replace(/\bMary\b/g, '玛丽').replace(/\bJohn\b/g, '约翰')

const texts = [...new Set([...words.map((w) => glossSpeech(glossParts(String(w[4] ?? '')))), ...sents.map((s) => s[2])].filter((t) => t && /[一-鿿]/.test(t)))]
const all = texts.map((text) => ({ key: zhKey(text), text, say: speakable(text) })).sort((a, b) => (a.key < b.key ? -1 : 1))
const keys = new Set(all.map((x) => x.key))
if (keys.size !== all.length) throw new Error(`键撞了：${all.length} 句只有 ${keys.size} 个键`)
let mine = all.filter((_, i) => i % shards === shard).filter((x) => !have.has(`zh/${x.key}`))
if (limit) mine = mine.slice(0, limit)
writeFileSync(arg('out', 'items.json'), JSON.stringify(mine))
console.log(`中文共 ${all.length} 句，这一片 ${mine.length} 句，${mine.reduce((a, x) => a + x.say.length, 0)} 字`)

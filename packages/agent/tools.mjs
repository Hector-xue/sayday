// 工具定义的唯一来源（方案 14.1）：MCP 的工具列表、Skill 的 SKILL.md、HTTP API 的 OpenAPI 都从这里生成，不各写各的
import { decodeAudio, getContent, readAudio, scoreAudio, transcribe, tokenize } from './core.mjs'
import { HINTS, IPA } from '../speech/hints.mjs'

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const audioParam = { type: 'string', description: '录音：http(s) 链接、本机文件路径或 base64 都行。支持 WAV、微信语音（silk）；其他格式（mp3/m4a/ogg）需要本机装 ffmpeg' }

/** 把打分结果整理成助手好转述的样子：总分、读错的词（哪个音、怎么改）、尾音问题 */
function feedback(r) {
  const bad = r.words.filter((w) => w.level !== 'g')
  const phones = new Map()
  for (const w of r.words) for (const p of w.phones) if (p.level === 'r') phones.set(p.p, (phones.get(p.p) ?? 0) + 1)
  return {
    score: r.score,
    verdict: r.score >= 85 ? '很好' : r.score >= 70 ? '不错，个别音要注意' : r.score >= 50 ? '能听懂，有几个音明显不准' : '要放慢、一个词一个词跟读',
    words: bad.map((w) => ({
      word: w.word,
      level: w.level === 'r' ? '读错' : '不太准',
      sounds: w.phones.filter((p) => p.level !== 'g').map((p) => `/${IPA[p.p] ?? p.p}/`),
      tail: w.tail === 'ins' ? `词尾 /${IPA[w.phones.at(-1).p]}/ 后面多带了元音` : w.tail === 'del' ? '词尾的音可能没读出来' : undefined,
    })),
    tips: [...phones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([p]) => HINTS[p]).map(([p]) => `/${IPA[p]}/：${HINTS[p]}`),
    skipped: r.skipped,
  }
}

const pick = (a, n) => [...a].sort(() => Math.random() - 0.5).slice(0, n)
const example = (w) => {
  const { sentsByWord } = getContent()
  const s = (sentsByWord.get(w.w) ?? []).slice().sort((a, b) => Math.max(0, a.hard - w.rank) - Math.max(0, b.hard - w.rank) || Math.abs(a.en.length - 32) - Math.abs(b.en.length - 32))[0]
  return s ? { en: s.en, zh: s.zh } : null
}
const brief = (w) => ({ word: w.w, ipa: w.ipa, zh: w.zh.split(/[；;]/)[0], cefr: w.cefr, rank: w.rank, example: example(w) })

export const TOOLS = [
  {
    name: 'score_pronunciation',
    title: '发音打分',
    description: '给一段英文录音打发音分（0~100），指出读错的词、错在哪个音、怎么改，以及词尾多加元音 / 吞音。不给 text 时先自动识别说了什么再打分。录音只在运行这个工具的机器上处理。',
    input: { type: 'object', properties: { audio: audioParam, text: { type: 'string', description: '应该读的英文原文（跟读时给；自由说话时可不给）' } }, required: ['audio'] },
    async run({ audio, text }) {
      const pcm = await decodeAudio(await readAudio(audio))
      if (pcm.length < 16000 * 0.4) throw new Error('录音太短（不到 0.4 秒）')
      const ref = text?.trim() || (await transcribe(pcm))
      if (!tokenize(ref).length) return { error: '没听出说了什么英文', transcript: ref }
      return { ...(text ? {} : { transcript: ref }), ...feedback(await scoreAudio(pcm, ref)) }
    },
  },
  {
    name: 'transcribe',
    title: '英文语音转文字',
    description: '把一段英文录音识别成文字（本机离线识别，模型 Moonshine）。口音重时会有错字。',
    input: { type: 'object', properties: { audio: audioParam }, required: ['audio'] },
    async run({ audio }) {
      const pcm = await decodeAudio(await readAudio(audio))
      return { text: await transcribe(pcm), seconds: +(pcm.length / 16000).toFixed(1) }
    },
  },
  {
    name: 'lookup_word',
    title: '查词',
    description: '查英文单词：音标、中文释义、难度（CEFR，按词频估算）、一句带中文的例句。',
    input: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
    async run({ word }) {
      const w = getContent().byWord.get(word.trim().toLowerCase())
      if (!w) return { found: false, word }
      return { found: true, ...brief(w), zh_full: w.zh, exam_tags: w.tags }
    },
  },
  {
    name: 'example_sentences',
    title: '例句',
    description: '给一个词找几句真实例句（Tatoeba，带中文翻译），按难度从易到难。',
    input: { type: 'object', properties: { word: { type: 'string' }, count: { type: 'integer', minimum: 1, maximum: 10, default: 3 } }, required: ['word'] },
    async run({ word, count = 3 }) {
      const { sentsByWord } = getContent()
      const list = (sentsByWord.get(word.trim().toLowerCase()) ?? []).slice().sort((a, b) => a.hard - b.hard).slice(0, count)
      return { word, sentences: list.map((s) => ({ en: s.en, zh: s.zh, cefr: s.cefr })) }
    },
  },
  {
    name: 'daily_words',
    title: '今天学什么词',
    description: '按学习者水平挑一组该学的新词（从水平边界往上），每个带音标、释义和例句。目标是雅思时优先雅思词汇。',
    input: { type: 'object', properties: { level: { type: 'string', enum: CEFR, description: '学习者现在的 CEFR 档' }, count: { type: 'integer', minimum: 1, maximum: 20, default: 8 }, goal: { type: 'string', enum: ['ielts', 'general'], default: 'general' }, exclude: { type: 'array', items: { type: 'string' }, description: '已经学过的词，跳过' } }, required: ['level'] },
    async run({ level, count = 8, goal = 'general', exclude = [] }) {
      const start = { A1: 300, A2: 1200, B1: 2200, B2: 3300, C1: 4800, C2: 7500 }[level] ?? 2200
      const skip = new Set(exclude.map((x) => x.toLowerCase()))
      let pool = getContent().words.filter((w) => w.rank >= start && w.rank < start + 600 && !w.sensitive && !skip.has(w.w) && w.w.length > 2)
      if (goal === 'ielts') pool = [...pool.filter((w) => w.tags.includes('ielts')), ...pool.filter((w) => !w.tags.includes('ielts'))]
      return { level, words: pick(pool.slice(0, count * 4), count).map(brief) }
    },
  },
  {
    name: 'speaking_question',
    title: '雅思口语题',
    description: '出一道雅思口语风格练习题（日日说原创题库，不是真题）。part=1 日常问答，2 话题卡（带要点和后续第三部分讨论题），3 讨论题。',
    input: { type: 'object', properties: { part: { type: 'integer', enum: [1, 2, 3], default: 1 } } },
    async run({ part = 1 }) {
      const { ielts } = getContent()
      if (part === 1) { const t = pick(ielts.part1, 1)[0]; return { part, topic: t.topic, topic_zh: t.topic_zh, questions: t.q } }
      const c = pick(ielts.part2, 1)[0]
      return part === 2 ? { part, card: c.card, card_zh: c.card_zh, points: c.points, prepare_seconds: 60, speak_seconds: 120, part3: c.part3 } : { part, topic: c.card, questions: c.part3 }
    },
  },
  {
    name: 'episode',
    title: '剧集台词',
    description: '日日说原创剧集的一集台词（第一季 Life in London A2→B1，第二季 Edinburgh B1→B2，每季 10 集），带中文和理解题；学习者在剧里演林（Lin）。适合陪读、分角色对练。',
    input: { type: 'object', properties: { season: { type: 'integer', minimum: 1, default: 1 }, n: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['n'] },
    async run({ season = 1, n }) {
      const s = getContent().seasons.find((x) => x.season === season)
      const e = s?.episodes.find((x) => x.id === n)
      if (!e) throw new Error('没有这一集')
      return { season, season_title: s.title, id: e.id, title: e.title, title_zh: e.title_zh, level: e.level, scene_zh: e.scene_zh, lines: e.lines, quiz: e.quiz, next_zh: e.next_zh }
    },
  },
]

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]))

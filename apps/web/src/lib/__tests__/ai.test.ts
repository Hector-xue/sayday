import { describe, expect, it, vi } from 'vitest'
vi.mock('../db', () => ({ db: {}, kvGet: async () => null, kvSet: async () => {}, today: () => '2026-10-12' }))
import { guessProvider, pickModel, providerOf, completeJson, AiError } from '../ai'
import { splitReply } from '../companion'

describe('AI 配置推断', () => {
  it('从密钥前缀认出服务商', () => {
    expect(guessProvider('sk-ant-api03-xx')).toBe('anthropic')
    expect(guessProvider('sk-or-v1-xx')).toBe('openrouter')
    expect(guessProvider('sk-abc')).toBeNull()
  })
  it('按偏好从模型列表挑：Kimi 挑最新的通用模型，不挑写代码的', () => {
    expect(pickModel(providerOf('kimi'), ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.7-code-highspeed'])).toBe('kimi-k3')
    expect(pickModel(providerOf('deepseek'), ['deepseek-reasoner', 'deepseek-chat'])).toBe('deepseek-chat')
    expect(pickModel(providerOf('anthropic'), ['claude-opus-4-1', 'claude-haiku-4-5-20251001', 'claude-3-5-haiku-20241022'])).toBe('claude-haiku-4-5-20251001')
    expect(pickModel(providerOf('glm'), ['glm-4-plus', 'glm-4.5-flash', 'glm-4-flash'])).toBe('glm-4.5-flash')
  })
})

describe('陪练回复拆分', () => {
  it('正常格式：回话 + 翻译 + 纠正', () => {
    const r = splitReply('Nice to meet you, Lin! What did you cook?\n###\n{"zh": "很高兴认识你，Lin！你做了什么菜？", "fix": {"you": "Yesterday I go to the supermarket", "better": "Yesterday I went to the supermarket", "why": "说昨天的事要用过去式"}}')
    expect(r.text).toBe('Nice to meet you, Lin! What did you cook?')
    expect(r.zh).toContain('很高兴')
    expect(r.fix?.better).toContain('went')
  })
  it('模型没按格式（没有 ###）：整段当回话，不报错', () => {
    expect(splitReply('Hello there!')).toEqual({ text: 'Hello there!' })
  })
  it('JSON 坏了：只丢掉翻译和纠正', () => {
    expect(splitReply('Hi!\n###\n{"zh": "你好', ).text).toBe('Hi!')
  })
  it('“纠正”和原句一样就不算纠正（护栏：不给假纠正）', () => {
    expect(splitReply('Ok\n###\n{"zh":"好","fix":{"you":"I like it","better":"I like it","why":""}}').fix).toBeNull()
  })
  it('流式时只显示 ### 之前', () => {
    expect(splitReply('Great idea! Let\'s go.\n##').text).toBe("Great idea! Let's go.\n##")
    expect(splitReply('Great idea!\n###\n{"z').text).toBe('Great idea!')
  })
})

describe('JSON 护栏', () => {
  const okJson = '{"a": 1}'
  const check = (x: any): x is { a: number } => typeof x?.a === 'number'
  it('第一次格式不对就重问一次', async () => {
    const replies = ['Sure! Here you go: not json', 'Here: ' + okJson]
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: replies.shift() } }] }), { status: 200 })) as any
    expect(await completeJson({ provider: 'deepseek', key: 'k', model: 'm' }, { messages: [{ role: 'user', content: 'x' }] }, check)).toEqual({ a: 1 })
  })
  it('两次都不对就报“格式不对”，不把坏数据往下传', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'nope' } }] }), { status: 200 })) as any
    await expect(completeJson({ provider: 'deepseek', key: 'k', model: 'm' }, { messages: [{ role: 'user', content: 'x' }] }, check)).rejects.toBeInstanceOf(AiError)
  })
  it('报错归类：401 密钥 / 402 余额 / Kimi 欠费的 429 也算余额', async () => {
    const run = async (status: number, body: string) => {
      globalThis.fetch = vi.fn(async () => new Response(body, { status })) as any
      try { await completeJson({ provider: 'kimi', key: 'k', model: 'm' }, { messages: [{ role: 'user', content: 'x' }] }, check) } catch (e) { return (e as AiError).kind }
    }
    expect(await run(401, '{}')).toBe('key')
    expect(await run(402, '{}')).toBe('money')
    expect(await run(429, '{"error":{"message":"suspended due to insufficient balance","type":"exceeded_current_quota_error"}}')).toBe('money')
    expect(await run(429, '{"error":"rate limited"}')).toBe('rate')
  })
})

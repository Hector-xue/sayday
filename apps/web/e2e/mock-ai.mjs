// 端到端用的假 AI 服务（OpenAI 兼容，带 CORS 和流式）：按请求内容回固定答案，只验证界面流程，不验证模型质量
import http from 'node:http'

const EMMA = 'Hi Lin! Did you go anywhere nice yesterday?\n###\n{"zh": "嗨 Lin！你昨天去哪儿玩了吗？", "fix": {"you": "Yesterday I go to the park", "better": "Yesterday I went to the park", "why": "说昨天的事要用过去式"}}'
const DIARY = JSON.stringify({
  corrected: 'Today was very busy. I had three meetings in the morning. After work I ate hotpot with my friends.',
  edits: [{ from: 'I have three meeting', to: 'I had three meetings', why: '过去的事用过去式，three 后面名词用复数' }, { from: '下班以后我和朋友去吃火锅', to: 'After work I ate hotpot with my friends', why: '用英文可以这样说' }],
  natural: 'Today was really busy. I had three meetings in the morning. After work, I went for hotpot with some friends.',
  phrases: [{ en: 'went for hotpot', zh: '去吃火锅' }, { en: 'really busy', zh: '特别忙' }, { en: 'after work', zh: '下班后' }],
  comment: '时间顺序写得很清楚。最值得改的是时态：写今天已经发生的事，动词用过去式。',
})

const IELTS = JSON.stringify({ fc: 6, lr: 5.5, gra: 5.5, p: 6, summary: '整体在 5.5~6 分左右，回答切题、能说出理由。', tips: ['回答再展开一句，加一个具体例子', '少用 very good，换成 really enjoyable 这类说法', '注意过去时：I go → I went'], better: { q: 'Do you like walking?', answer: 'Yes, I really do. I usually go for a walk after dinner, because it helps me relax after work. Sometimes I walk along the river near my flat, which is lovely in the evening.' } })

export function startMockAi(port = 5392) {
  const srv = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type')
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'mock-chat' }] })) }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const j = JSON.parse(body || '{}')
      const all = JSON.stringify(j.messages ?? [])
      const text = all.includes('Reply with just: OK') ? 'OK' : all.includes('IELTS Speaking test') ? IELTS : all.includes('You are Emma') ? EMMA : all.includes('diary entry') ? DIARY : all.includes('Existing facts') ? '{"facts": ["The learner is called Lin"]}' : 'OK'
      if (!j.stream) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ choices: [{ message: { content: text } }] })) }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const parts = text.match(/.{1,12}/gs)
      let i = 0
      const t = setInterval(() => {
        if (i < parts.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`)
        else { res.write('data: [DONE]\n\n'); res.end(); clearInterval(t) }
      }, 20)
    })
  })
  srv.listen(port, '127.0.0.1')
  return srv
}

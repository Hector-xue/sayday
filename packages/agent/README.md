# sayday-agent：让你在用的 AI 助手也会教英语

把日日说的能力做成工具，交给你已经在用的 AI 助手（Codex、Claude Code、WorkBuddy / OpenClaw、能连远程 MCP 的 Grok……），不占用微信里唯一的那个机器人名额。

| 工具 | 做什么 |
|---|---|
| `score_pronunciation` | 英文录音打发音分（0~100），指出读错的词、错在哪个音、怎么改，词尾多加元音 / 吞音。支持 WAV、**微信语音（silk）**，其他格式要装 ffmpeg |
| `transcribe` | 英文语音转文字（离线，Moonshine） |
| `lookup_word` / `example_sentences` | 查词（音标、释义、难度）、真实例句 |
| `daily_words` | 按水平挑一组新词，雅思目标优先雅思词 |
| `speaking_question` | 雅思口语风格练习题（原创题库） |
| `episode` | 剧集《Life in London》台词，陪读 / 分角色对练 |

打分和识别跟 App 是同一套代码，分数口径一致；录音只在运行它的机器上处理。

## 准备
```bash
cd packages/agent && npm ci
../../scripts/fetch-phone-model.sh   # 音素打分模型（从最新 Release 安装包里取，约 120MB）
../../scripts/fetch-asr-model.sh     # 语音识别模型（约 63MB）
npm test                             # 4 项自检：silk 解码打分、MCP stdio、HTTP 鉴权
```

## 接到你的助手
**四层接入，能用哪层用哪层**（工具定义只有一份：`tools.mjs`，下面几种都从它生成）：

1. **本地 MCP（stdio）**
   - Claude Code：`claude mcp add sayday -- node /绝对路径/packages/agent/cli.mjs mcp`
   - Codex（`~/.codex/config.toml`）：
     ```toml
     [mcp_servers.sayday]
     command = "node"
     args = ["/绝对路径/packages/agent/cli.mjs", "mcp"]
     ```
   - WorkBuddy / 其他支持 `mcpServers` JSON 的：`{"mcpServers": {"sayday": {"command": "node", "args": ["/绝对路径/packages/agent/cli.mjs", "mcp"]}}}`
2. **远程 MCP（Streamable HTTP）**：`SAYDAY_TOKEN=至少16位的随机串 node cli.mjs http 8790`，只监听 127.0.0.1，公网用反向代理加 HTTPS；助手里填 `https://你的域名/mcp`，请求头 `Authorization: Bearer <token>`。
3. **Skill**：把 `skill/SKILL.md` 放进助手的 skills 目录（里面写了什么时候用、怎么给中文反馈、拿不到录音时不要假装打分），脚本调用 `node cli.mjs call <工具> '<JSON>'`。
4. **HTTP API**：`POST /api/<工具名>`，JSON 参数，描述见 `openapi.json`（`node cli.mjs gen` 重新生成）。

## 关键限制（方案 14.2）
很多助手收到微信语音后**只把转写文字交给模型，原始音频丢了**，这样就没法做音素级纠音。`score_pronunciation` 接受链接、文件路径、base64 三种输入，助手拿得到哪种就传哪种；拿不到音频时，Skill 会让它如实告诉你“发音打分请用日日说 App”，不编分数。各家助手的实测情况记在 [docs/agents.md](../../docs/agents.md)。

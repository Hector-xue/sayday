# AI 助手兼容性

`packages/agent` 的工具在各家助手里的实测情况。欢迎补充（写上测试日期、助手版本、接入方式）。

| 助手 | 接入方式 | 能列出 / 调用工具 | 能把用户的语音原文件传给工具 | 测试日期 | 备注 |
|---|---|---|---|---|---|
| MCP 官方 SDK 客户端（stdio / Streamable HTTP） | 本地 / 远程 MCP | ✅ | ✅（base64 / 路径） | 2026-10-12 | `npm test` 里的自检 |
| Claude Code | 本地 MCP | 待测 | 待测 | | |
| Codex | 本地 MCP | 待测 | 待测 | | |
| WorkBuddy / OpenClaw | MCP 或 Skill | 待测 | 待测 | | 微信语音能否拿到 silk 原文件是关键 |
| Grok（API remote MCP） | 远程 MCP | 待测 | 待测 | | 只支持 Streamable HTTP / SSE |

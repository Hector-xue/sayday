# 日日说 Sayday

一个让人能坚持下去的英语学习软件：离线可用、AI 可插拔、带逐音素的发音纠正。网页和手机 App 共用一套代码。

> 状态：**M2 进行中**（见 [docs/M2-进展.md](docs/M2-进展.md)）。已可用：定级与持续校准 → 每日一课（FSRS 复习 + 新词 + 听力 + 跟读打分）→ 原创剧集三季 30 集（A2→C1）→ 发音实验室（最小对立、口型图、语调曲线）→ 雅思听力 / 阅读整套练习（本机判分）、口语模考、写作批改 → 接入自己的 AI 后的陪练聊天与日记批改；安卓有每日提醒和桌面小组件。网页（PWA，离线可用）与安卓 App 共用一套界面。

## 设计原则
- **门槛降到最低**：每天保底 2 分钟就算学了；断签不惩罚。
- **进步看得见**：水平按 CEFR 分项估计，录音可前后对比。
- **离线优先**：复习、跟读评分、词典都在本机完成；AI 只做增强，可以接自己的模型或 API。
- **不打开 App 也能学**：通过 MCP / Skill / HTTP 接入你已经在用的 agent 或聊天机器人。

## M0 结论（详见 [docs/M0-技术验证报告.md](docs/M0-技术验证报告.md)）
- 离线逐音素发音评分：一个 122MB 的 int8 模型，在 speechocean762（中国学习者）上与人工评分的音素级相关 0.60。
- 评分算法（免对齐 CTC-GOP + 树模型校准）已用纯 JS 实现，并与 Python 参考逐位对拍通过。
- 浏览器端：onnxruntime-web 推理、SQLite（OPFS）持久化、Service Worker 断网可用，均已验证。
- 微信语音（SILK）编码后评分精度基本无损。

## 目录
| 路径 | 内容 |
|---|---|
| `apps/web/` | 正式版（React + TypeScript + Vite，PWA）：定级、每日一课、剧集、发音实验室、雅思专项、AI 陪练 / 日记、词库、进步、设置 |
| `apps/native/` | Tauri 2 安卓外壳 + 原生推理插件 `sayday-infer`，界面就是 `apps/web`（CI 构建并签名，见 `.github/workflows/android.yml`） |
| `packages/speech/` | 发音评分核心（CTC-GOP、校准、尾音检查、整句分），网页 / App / 演示页 / MCP 共用 |
| `packages/asr/` | 离线语音识别（Moonshine 解码），网页 / App / MCP 共用 |
| `packages/agent/` | 给 AI 助手用的工具：本地 / 远程 MCP、Skill、HTTP API（[说明](packages/agent/README.md)） |
| `content/` | 内容包构建（`build_content.py`：ECDICT 词表 + Tatoeba 例句 + 定级假词）、剧集台词（`episodes/`，原创）、雅思题库（`ielts/`，原创）与示范音频包（`audio/`，CI 生成） |
| `site/` | 门户 sayday.ivyea.com |
| `docs/` | 技术验证报告、进展 |
| `spikes/` | M0/M1 验证脚本、浏览器演示页 |
| `scripts/` | 构建与部署脚本 |

## 第三方资源与授权
| 资源 | 用途 | 授权 |
|---|---|---|
| [speechocean762](https://www.openslr.org/101/) | 评测与校准；`spikes/m0/web/samples/u*.f32` 是其中 3 条录音的派生数据 | CC BY 4.0（Junbo Zhang 等） |
| [charsiu/en_w2v2_ctc_libris_and_cv](https://huggingface.co/charsiu/en_w2v2_ctc_libris_and_cv) | 音素识别模型（不在仓库内，需自行下载）；论文 Zhu et al., *Phone-to-audio alignment without text*, ICASSP 2022 | 模型页未标注；项目代码 MIT，**正式发版前需确认** |
| [CMUdict](https://github.com/cmusphinx/cmudict) | 发音词典 | BSD，见 `packages/speech/cmudict.LICENSE` |
| [ECDICT](https://github.com/skywind3000/ECDICT) | 词表、释义、音标、词频、考试标签（`content/pack/words.json`） | MIT |
| [Tatoeba](https://tatoeba.org)（经 [manythings.org](https://www.manythings.org/anki/) 打包的中英句对） | 例句（`content/pack/sentences.json`，每句保留 Tatoeba 原句号） | CC BY 2.0 FR |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)（[ONNX 版](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)） | 示范读音合成：预置音频与音频包（`content/audio`）由它生成 | Apache-2.0 |
| [Moonshine base](https://huggingface.co/UsefulSensors/moonshine-base)（[ONNX 版](https://huggingface.co/onnx-community/moonshine-base-ONNX)） | 离线语音识别（说话输入、口语模考、MCP 转写），首次使用时下载 | MIT |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | 间隔复习算法 | MIT |
| [kokoro-js](https://github.com/hexgrad/kokoro/tree/main/kokoro.js) | 只在 CI 里用来生成音频包（应用本身不带；它打包的 eSpeak NG 是 GPL-3.0，所以 v0.0.4 起去掉了浏览器内合成） | Apache-2.0 |
| onnxruntime-web / onnxruntime-node / SQLite WASM / silk-wasm / MCP SDK | 运行时 | MIT / MIT / 公有领域 / MIT / MIT |
| 品牌图标 `assets/brand/` | 应用与网站图标 | 本项目所有 |

## 许可证
代码以 [MIT](LICENSE) 发布。

# 日日说 Sayday

一个让人能坚持下去的英语学习软件：离线可用、AI 可插拔、带逐音素的发音纠正。网页和手机 App 共用一套代码。

> 状态：**M0 技术验证已完成，M1 进行中**（见 [docs/M1-进展.md](docs/M1-进展.md)）。目前仓库里是验证脚本、网页演示页和安卓测速 App，还没有正式产品代码。

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
| `docs/` | 技术验证报告 |
| `spikes/m0/` | M0/M1 验证脚本、浏览器演示页（`web/demo.html`） |
| `apps/native/` | Tauri 2 App 外壳 + 安卓原生推理插件 `sayday-infer`（CI 构建，见 `.github/workflows/android-bench.yml`） |
| `scripts/` | 部署脚本 |

## 第三方资源与授权
| 资源 | 用途 | 授权 |
|---|---|---|
| [speechocean762](https://www.openslr.org/101/) | 评测与校准；`spikes/m0/web/samples/u*.f32` 是其中 3 条录音的派生数据 | CC BY 4.0（Junbo Zhang 等） |
| [charsiu/en_w2v2_ctc_libris_and_cv](https://huggingface.co/charsiu/en_w2v2_ctc_libris_and_cv) | 音素识别模型（不在仓库内，需自行下载） | 模型页未标注；项目代码 MIT，**正式发版前需确认** |
| [CMUdict](https://github.com/cmusphinx/cmudict) | 发音词典 | BSD，见 `spikes/m0/web/samples/cmudict.LICENSE` |
| onnxruntime-web / SQLite WASM / silk-wasm | 运行时 | MIT / 公有领域 / MIT |

## 许可证
代码以 [MIT](LICENSE) 发布。

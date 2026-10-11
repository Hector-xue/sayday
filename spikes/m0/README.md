# M0 技术验证（spike）

一次性验证脚本，不是产品代码。结论见 `docs/M0-技术验证报告.md`。

| 脚本 | 作用 |
|---|---|
| `export_onnx.py` | charsiu 音素 CTC 模型 → ONNX（fp32 / int8） |
| `infer_so762.py` | 在 speechocean762 上跑推理、缓存后验、测耗时；`--codec silk` 走微信 SILK 编解码 |
| `score_eval.py` | 强制对齐 + 三种 GOP 特征，与人工逐音素打分对比，落特征表 |
| `calibrate.py` | 训练集拟合校准模型（ridge / gbdt），测试集评估 |
| `silk_roundtrip.mjs` | SILK v3 编解码往返（silk-wasm） |
| `web/` + `run_browser.mjs` + `serve.py` | 浏览器端：onnxruntime-web 推理一致性与耗时、SQLite+OPFS 持久化、Service Worker 断网可用 |

复现：
```bash
python3 -m venv .venv && .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install "numpy<2.1" transformers==4.46.3 soundfile pyarrow pandas onnx onnxruntime==1.19.2 scipy scikit-learn
# 模型与数据下载到 .cache/（见报告“复现”一节）
.venv/bin/python spikes/m0/export_onnx.py
.venv/bin/python spikes/m0/infer_so762.py --model int8 && .venv/bin/python spikes/m0/infer_so762.py --model int8 --split train
.venv/bin/python spikes/m0/score_eval.py --logits int8 && .venv/bin/python spikes/m0/score_eval.py --logits int8 --split train
.venv/bin/python spikes/m0/calibrate.py --train int8 --test int8
cd spikes/m0 && npm ci && node run_browser.mjs ../../.cache/browser_result.json
```

"""中国口音微调：在 speechocean762 训练集上继续训练 charsiu 音素 CTC（方案见 docs/口音微调方案.md）。

只用 CPU（GitHub 免费机器），所以：冻结卷积特征提取层，按时长攒批，限时跑完存检查点，下一个任务接着跑。

标签 = 学习者“实际读出的音”：人工标注里读成别的音就用那个音，<DEL> 去掉，<unk>（含糊、哪个音都不像）用 [UNK]，
首尾各加一个 [SIL]（和原模型的输出习惯一致）。

数据切分：训练集说话人按 id 排序，奇偶分成 A / B 两半——A 拿来微调，B 留给后面拟合打分校准（不能用模型训练过的句子来校准）。

用法:
  python spikes/ft/train.py --minutes 330 [--resume ckpt.pt] [--epochs 6] [--bench 40]
产物: .cache/ft/ckpt.pt（模型 + 优化器 + 进度），.cache/ft/log.jsonl
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import math
import random
import time
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import soundfile as sf
import torch
from transformers import Wav2Vec2Config, Wav2Vec2ForCTC

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
M = CACHE / "models"
OUT = CACHE / "ft"
VOCAB = json.loads((M / "charsiu_vocab.json").read_text())
SIL, UNK = VOCAB["[SIL]"], VOCAB["[UNK]"]


def strip(p: str) -> str:
    return "".join(c for c in p if not c.isdigit())


def labels_of(words) -> list[int]:
    out = [SIL]
    for w in words:
        mis = {m["index"]: m["pronounced-phone"] for m in w["mispronunciations"] or []}
        for i, p in enumerate(w["phones"]):
            q = mis.get(i, p)
            if q == "<DEL>":
                continue
            # “T*” 是带口音、走了样的 T，当作含糊音；“IH R” 是一个音读成了两个
            out.extend(UNK if t == "<unk>" or t.endswith("*") else VOCAB[strip(t)] for t in q.split())
    out.append(SIL)
    return out


def speakers_split(rows) -> tuple[set, set]:
    sp = sorted({r["speaker"] for r in rows})
    return set(sp[0::2]), set(sp[1::2])


def load(part: str):
    """part: A / B（按说话人对半分）或 all（整个训练集）"""
    rows = pq.read_table(CACHE / "data" / "so762_train.parquet", columns=["audio", "words", "speaker"]).to_pylist()
    a, b = speakers_split(rows)
    keep = {"A": a, "B": b, "all": a | b}[part]
    data = []
    for r in rows:
        if r["speaker"] not in keep:
            continue
        wav, sr = sf.read(io.BytesIO(r["audio"]["bytes"]), dtype="float32")
        if wav.ndim > 1:
            wav = wav.mean(axis=1)
        assert sr == 16000, sr
        wav = (wav - wav.mean()) / np.sqrt(wav.var() + 1e-7)
        data.append((wav.astype(np.float32), labels_of(r["words"])))
    return data


def batches(data, max_seconds: float, seed: int):
    """按长度分桶再打乱，每批总时长不超过 max_seconds（CPU 内存有限，padding 越少越快）"""
    idx = sorted(range(len(data)), key=lambda i: len(data[i][0]))
    out, cur, longest = [], [], 0
    for i in idx:
        n = len(data[i][0])
        if cur and max(longest, n) * (len(cur) + 1) > max_seconds * 16000:
            out.append(cur)
            cur, longest = [], 0
        cur.append(i)
        longest = max(longest, n)
    if cur:
        out.append(cur)
    random.Random(seed).shuffle(out)
    return out


def collate(data, ids):
    xs = [data[i][0] for i in ids]
    ys = [data[i][1] for i in ids]
    T = max(len(x) for x in xs)
    x = torch.zeros(len(xs), T)
    att = torch.zeros(len(xs), T, dtype=torch.long)
    for k, w in enumerate(xs):
        x[k, : len(w)] = torch.from_numpy(w)
        att[k, : len(w)] = 1
    L = max(len(y) for y in ys)
    y = torch.full((len(ys), L), -100, dtype=torch.long)
    for k, t in enumerate(ys):
        y[k, : len(t)] = torch.tensor(t)
    return x, att, y


XLSR = "facebook/wav2vec2-xlsr-53-espeak-cv-ft"


def build_xlsr() -> Wav2Vec2ForCTC:
    """授权明确的备选（Apache-2.0）：输出层从 392 个国际音标换成 charsiu 的 42 个音素。
    新输出层每一行用对应国际音标那一行的权重起步（spikes/alt/export_xlsr.py 的对应表），等于从它已经会的地方接着学"""
    sys.path.insert(0, str(ROOT / "spikes" / "alt"))
    from export_xlsr import IPA2CMU
    from huggingface_hub import hf_hub_download
    model = Wav2Vec2ForCTC.from_pretrained(XLSR)
    src = json.loads(Path(hf_hub_download(XLSR, "vocab.json")).read_text())
    dst = json.loads((M / "charsiu_vocab.json").read_text())
    old = model.lm_head
    head = torch.nn.Linear(old.in_features, len(dst))
    with torch.no_grad():
        head.weight.normal_(0, 0.02)
        head.bias.zero_()
        first = {}
        for tok, cmu in IPA2CMU.items():  # 对应表里每个 CMU 音素排第一的国际音标是它的主要写法
            if tok in src:
                first.setdefault(cmu, src[tok])
        rows = {dst[k]: v for k, v in first.items()} | {dst["[PAD]"]: src["<pad>"], dst["[UNK]"]: src["<unk>"], dst["[SIL]"]: src["<pad>"]}
        for k, v in rows.items():
            head.weight[k] = old.weight[v]
            head.bias[k] = old.bias[v]
        head.bias[dst["[SIL]"]] -= 2.0  # 静音和空白起点一样，先压低一点，让它从数据里学出来
    model.lm_head = head
    model.config.vocab_size = len(dst)
    model.config.pad_token_id = dst["[PAD]"]  # CTC 空白
    model.config.ctc_loss_reduction = "mean"
    model.config.ctc_zero_infinity = True
    model.config.mask_time_prob = 0.05
    model.config.layerdrop = 0.0
    model.freeze_feature_encoder()
    # 3 亿参数的大模型在 16GB 内存的 CPU 机器上训练：用梯度检查点换内存
    model.gradient_checkpointing_enable()
    return model


def build_model() -> Wav2Vec2ForCTC:
    cfg = Wav2Vec2Config.from_json_file(str(M / "charsiu_config.json"))
    # 和原模型训练时一样做时间遮挡（SpecAugment），防止在两千多句上过拟合
    cfg.mask_time_prob = 0.05
    cfg.layerdrop = 0.0
    cfg.ctc_zero_infinity = True
    model = Wav2Vec2ForCTC(cfg)
    state = torch.load(M / "charsiu_ctc.bin", map_location="cpu", weights_only=True)
    missing, unexpected = model.load_state_dict(state, strict=False)
    real_missing = [k for k in missing if "pos_conv" not in k]
    if real_missing or unexpected:
        raise SystemExit(f"权重不匹配: missing={real_missing[:5]} unexpected={unexpected[:5]}")
    model.freeze_feature_encoder()
    return model


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=330, help="这次最多跑多久（GitHub 单个任务上限 6 小时）")
    ap.add_argument("--resume", type=Path)
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--batch-seconds", type=float, default=48)
    ap.add_argument("--bench", type=int, default=0, help="只跑这么多步测速，不存检查点")
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--base", choices=["charsiu", "xlsr"], default="charsiu", help="从哪个模型起步：charsiu，或授权明确的 xlsr-53 espeak（大 3 倍）")
    ap.add_argument("--part", choices=["A", "B", "all"], default="A", help="用哪部分说话人训练（交叉拟合要 A、B 各一个，最终模型用 all）")
    a = ap.parse_args()
    if a.threads:
        torch.set_num_threads(a.threads)
    OUT.mkdir(parents=True, exist_ok=True)
    t_start = time.time()

    data = load(a.part)
    total_s = sum(len(w) for w, _ in data) / 16000
    print(f"{a.part}：{len(data)} 句，{total_s/60:.1f} 分钟音频，线程 {torch.get_num_threads()}", flush=True)

    model = build_xlsr() if a.base == "xlsr" else build_model()
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=a.lr, weight_decay=0.0)
    steps_per_epoch = len(batches(data, a.batch_seconds, 0))
    total_steps = steps_per_epoch * a.epochs
    warm = max(1, int(total_steps * 0.1))
    # 先线性升温再余弦降到 0
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1, s / total_steps))))
    state = {"epoch": 0, "step_in_epoch": 0, "global": 0}
    if a.resume and a.resume.exists():
        ck = torch.load(a.resume, map_location="cpu", weights_only=False)
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        sched.load_state_dict(ck["sched"])
        state = ck["state"]
        print("接着跑：", state, flush=True)

    def save(done: bool):
        torch.save({"model": model.state_dict(), "config": model.config.to_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(), "state": state | {"done": done}}, OUT / "ckpt.pt.tmp")
        (OUT / "ckpt.pt.tmp").replace(OUT / "ckpt.pt")
        (OUT / "state.json").write_text(json.dumps(state | {"done": done, "total_steps": total_steps}))

    log = (OUT / "log.jsonl").open("a")
    model.train()
    budget = a.minutes * 60
    step_times: list[float] = []
    while state["epoch"] < a.epochs:
        bs = batches(data, a.batch_seconds, state["epoch"])
        losses = []
        while state["step_in_epoch"] < len(bs):
            ids = bs[state["step_in_epoch"]]
            t0 = time.time()
            x, att, y = collate(data, ids)
            loss = model(x, attention_mask=att, labels=y).loss
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            opt.step()
            sched.step()
            dt = time.time() - t0
            step_times.append(dt)
            losses.append(float(loss))
            state["step_in_epoch"] += 1
            state["global"] += 1
            if state["global"] % 10 == 0 or a.bench:
                rec = {"epoch": state["epoch"], "step": state["step_in_epoch"], "of": len(bs), "loss": round(float(np.mean(losses[-10:])), 4), "sec": round(dt, 2), "audio_s": round(sum(len(data[i][0]) for i in ids) / 16000, 1), "lr": sched.get_last_lr()[0]}
                print(json.dumps(rec), flush=True)
                log.write(json.dumps(rec) + "\n")
                log.flush()
            if a.bench and state["global"] >= a.bench:
                per = float(np.mean(step_times[2:] or step_times))
                print(json.dumps({"bench": True, "sec_per_step": round(per, 2), "steps_per_epoch": steps_per_epoch, "hours_per_epoch": round(per * steps_per_epoch / 3600, 2)}), flush=True)
                return
            # 留 10 分钟余量给存检查点和上传
            if time.time() - t_start > budget:
                save(False)
                print("时间到，存检查点：", state, flush=True)
                return
        print(f"第 {state['epoch']+1} 轮完，平均 loss {np.mean(losses):.4f}", flush=True)
        state["epoch"] += 1
        state["step_in_epoch"] = 0
    save(True)
    print("训练完成", flush=True)


if __name__ == "__main__":
    main()

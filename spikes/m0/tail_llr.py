"""加尾音 / 漏尾音（第二版）：不走贪心解码，直接用 CTC 似然比做假设检验。

对每个词尾辅音位置 i：
  加尾音 LLR = log Σ_v P(在 i 后插入元音 v) − log P(标准读音)
  漏尾音 LLR = log P(删掉 i) − log P(标准读音)
LLR > 阈值即判定。评估方式同 tail_detect.py。

用法: .venv/bin/python spikes/m0/tail_llr.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).parent))
import score_eval as se  # noqa: E402
from tail_detect import VOWEL_NAMES, VOWELS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"


def loglik(lp: np.ndarray, seqs: list[list[int]]) -> np.ndarray:
    T = lp.shape[0]
    x = torch.from_numpy(lp).float().unsqueeze(1).expand(T, len(seqs), lp.shape[1])
    L = max(1, max(len(s) for s in seqs))
    tgt = torch.full((len(seqs), L), se.BLANK, dtype=torch.long)
    for k, s in enumerate(seqs):
        if s:
            tgt[k, : len(s)] = torch.tensor(s)
    nll = F.ctc_loss(x, tgt, torch.full((len(seqs),), T, dtype=torch.long), torch.tensor([len(s) for s in seqs]), blank=se.BLANK, reduction="none")
    return -nll.numpy()


def tail_llr(lp: np.ndarray, ref: list[int], word_of: list[int]) -> dict[int, tuple[float, float]]:
    """返回 {词下标: (加尾音 LLR, 漏尾音 LLR)}，只含以辅音结尾的词。"""
    last = {}
    for k, w in enumerate(word_of):
        last[w] = k
    seqs, owner = [ref], []
    for w, i in last.items():
        if ref[i] in VOWELS:
            continue
        for v in VOWELS:
            seqs.append(ref[: i + 1] + [v] + ref[i + 1 :])
            owner.append((w, "ins"))
        seqs.append(ref[:i] + ref[i + 1 :])
        owner.append((w, "del"))
    ll = loglik(lp, seqs)
    canon = ll[0]
    out: dict[int, list] = {}
    for (w, kind), v in zip(owner, ll[1:]):
        out.setdefault(w, {"ins": [], "del": []})[kind].append(v)
    return {w: (float(np.logaddexp.reduce(d["ins"]) - canon), float(d["del"][0] - canon)) for w, d in out.items()}


def main() -> None:
    cached = CACHE / "tail_llr_recs.npy"
    if cached.exists():
        report(np.load(cached))
        return
    z = np.load(CACHE / "logits_int8.npz")
    rows = pq.read_table(CACHE / "data" / "so762_test.parquet", columns=["accuracy", "words"]).to_pylist()
    recs = []
    for i, r in enumerate(rows):
        ref, word_of, gold = [], [], set()
        for wi, w in enumerate(r["words"]):
            lastp = len(w["phones"]) - 1
            for m in w["mispronunciations"]:
                if m["pronounced-phone"] == "<DEL>" and m["index"] == lastp and re.sub(r"\d", "", m["canonical-phone"]) not in VOWEL_NAMES:
                    gold.add(wi)
            for p in w["phones"]:
                p = re.sub(r"\d", "", p)
                if p in se.VOCAB:
                    ref.append(se.VOCAB[p])
                    word_of.append(wi)
        if not ref:
            continue
        for w, (ins, dele) in tail_llr(se.fold_sil(z[f"u{i}"]), ref, word_of).items():
            recs.append((i, w, ins, dele, w in gold, r["words"][w]["accuracy"], r["accuracy"]))
        if i % 500 == 0:
            print("done", i, flush=True)
    a = np.array([(x[2], x[3], x[4], x[5], x[6]) for x in recs], dtype=float)
    np.save(cached, a)
    report(a)


def report(a: np.ndarray) -> None:
    ins, dele, gold, wacc, uacc = a.T
    res = {"词尾为辅音的词数": len(a), "漏尾音标注数": int(gold.sum())}
    for th in [0.0, 3.0, 5.0, 8.0, 12.0]:
        p = dele > th
        tp = (p & (gold == 1)).sum()
        res[f"漏尾音 LLR>{th}"] = {"标出": int(p.sum()), "查准": round(float(tp / max(p.sum(), 1)), 2), "召回": round(float(tp / gold.sum()), 2)}
    for th in [0.0, 3.0, 5.0, 8.0]:
        p = ins > th
        good = uacc >= 9
        res[f"加尾音 LLR>{th}"] = {
            "标出": int(p.sum()),
            "标出词人工词分": round(float(wacc[p].mean()), 2) if p.any() else None,
            "其余词人工词分": round(float(wacc[~p].mean()), 2),
            "好句子里的词被标出比例": round(float((p & good).sum() / good.sum()), 3),
        }
    (CACHE / "tail_llr_result.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

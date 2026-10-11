"""加尾音 / 漏尾音检测（M1）：识别序列与标准读音对齐，按词定位。

  加尾音：词尾辅音之后、下一个词开始之前，识别出了一个多余的元音（如 set → "seta"）
  漏尾音：词尾辅音在对齐里被删掉，且该音素的 GOP 也很低（双重证据，减少误报）

speechocean762 只标注了漏读（<DEL>），没有标注加尾音，所以：
  漏尾音 → 用人工标注直接算查准/召回
  加尾音 → 间接验证：被标出的词，人工词分是否明显更低；发音好的句子里误报率是否很低

用法: .venv/bin/python spikes/m0/tail_detect.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent))
import score_eval as se  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
VOWEL_NAMES = ["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]
VOWELS = {se.VOCAB[p] for p in VOWEL_NAMES}


def greedy_with_peak(lp: np.ndarray) -> tuple[list[int], list[float]]:
    """贪心解码，同时返回每个识别音素的峰值后验概率。"""
    ids = lp.argmax(axis=1)
    out, peak, prev = [], [], -1
    for t, i in enumerate(ids):
        if i in (se.BLANK, se.SIL):
            prev = i
            continue
        p = float(np.exp(lp[t, i]))
        if i != prev:
            out.append(int(i))
            peak.append(p)
        else:
            peak[-1] = max(peak[-1], p)
        prev = i
    return out, peak


def align(ref: list[int], hyp: list[int]) -> list[tuple[str, int, int]]:
    """编辑距离回溯，返回按顺序的操作 (op, ref_idx, hyp_idx)；op ∈ ok/sub/ins/del。"""
    n, m = len(ref), len(hyp)
    d = np.zeros((n + 1, m + 1), dtype=np.int32)
    d[:, 0] = np.arange(n + 1)
    d[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]))
    ops = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i, j] == d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            ops.append(("ok" if ref[i - 1] == hyp[j - 1] else "sub", i - 1, j - 1))
            i, j = i - 1, j - 1
        elif j > 0 and d[i, j] == d[i, j - 1] + 1:
            ops.append(("ins", i - 1, j - 1))  # 插在 ref[i-1] 之后
            j -= 1
        else:
            ops.append(("del", i - 1, -1))
            i -= 1
    return ops[::-1]


def detect(lp: np.ndarray, ref: list[int], word_of: list[int], af: np.ndarray, peak_min=0.6, del_af_max=-3.0) -> dict:
    hyp, peak = greedy_with_peak(lp)
    ops = align(ref, hyp)
    last_of = {}
    for k, w in enumerate(word_of):
        last_of[w] = k
    epen, drop = {}, {}
    for op, ri, hj in ops:
        if op == "ins" and ri >= 0 and hyp[hj] in VOWELS and peak[hj] >= peak_min:
            w = word_of[ri]
            if last_of[w] == ri and ref[ri] not in VOWELS:
                epen[w] = hyp[hj]
        if op == "del" and ref[ri] not in VOWELS and last_of[word_of[ri]] == ri and af[ri] <= del_af_max:
            drop[word_of[ri]] = ref[ri]
    return {"epen": epen, "drop": drop}


def main() -> None:
    z = np.load(CACHE / "logits_int8.npz")
    f = np.load(CACHE / "feats_int8.npz")
    rows = pq.read_table(CACHE / "data" / "so762_test.parquet", columns=["accuracy", "words", "age"]).to_pylist()
    res = {}
    for peak_min, del_af in [(0.5, -2.0), (0.6, -3.0), (0.8, -4.0)]:
        tp = fp = fn = 0
        flag_acc, other_acc = [], []
        good_utts = good_flag = 0
        for i, r in enumerate(rows):
            ref, word_of, gold_drop = [], [], set()
            for wi, w in enumerate(r["words"]):
                last = len(w["phones"]) - 1
                for m in w["mispronunciations"]:
                    if m["pronounced-phone"] == "<DEL>" and m["index"] == last and re.sub(r"\d", "", m["canonical-phone"]) not in VOWEL_NAMES:
                        gold_drop.add(wi)
                for p in w["phones"]:
                    p = re.sub(r"\d", "", p)
                    if p in se.VOCAB:
                        ref.append(se.VOCAB[p])
                        word_of.append(wi)
            af = f["feats"][f["utt"] == i][:, 2]
            if len(af) != len(ref):
                continue
            d = detect(se.fold_sil(z[f"u{i}"]), ref, word_of, af, peak_min, del_af)
            pred = set(d["drop"])
            tp += len(pred & gold_drop)
            fp += len(pred - gold_drop)
            fn += len(gold_drop - pred)
            for wi, w in enumerate(r["words"]):
                (flag_acc if wi in d["epen"] else other_acc).append(w["accuracy"])
            if r["accuracy"] >= 9:
                good_utts += 1
                good_flag += bool(d["epen"])
        res[f"峰值≥{peak_min}, 删除需GOP≤{del_af}"] = {
            "漏尾音": {"标注数": tp + fn, "查准": round(tp / max(tp + fp, 1), 2), "召回": round(tp / max(tp + fn, 1), 2)},
            "加尾音": {
                "标出的词数": len(flag_acc),
                "标出词的人工词分均值": round(float(np.mean(flag_acc)), 2) if flag_acc else None,
                "其余词的人工词分均值": round(float(np.mean(other_acc)), 2),
                "好句子(≥9分)中被标出的比例": round(good_flag / max(good_utts, 1), 3),
            },
        }
    (CACHE / "tail_detect_result.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

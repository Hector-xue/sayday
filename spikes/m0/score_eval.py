"""音素级发音评分（GOP）并与 speechocean762 人工标注对比。

三种 GOP 特征：
  lpp   强制对齐后，规范音素在其帧上的平均对数后验
  lpr   同上，减去同帧最强竞争音素的对数后验
  af    免对齐 CTC-GOP：log P(规范序列) 相对于把该音素替换/删除后的所有变体的后验份额

用法: .venv/bin/python spikes/m0/score_eval.py --logits int8 [--limit N]
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import torch
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
VOCAB = json.loads((CACHE / "models" / "charsiu_vocab.json").read_text())
BLANK, SIL = VOCAB["[PAD]"], VOCAB["[SIL]"]
PHONES = [p for p in VOCAB if not p.startswith("[")]
PID = [VOCAB[p] for p in PHONES]


def fold_sil(logp: np.ndarray) -> np.ndarray:
    """把 [SIL] 并入 blank：停顿不应算作任何音素。返回去掉 SIL 列后的后验（blank 列已合并）。"""
    lp = logp.astype(np.float64).copy()
    lp[:, BLANK] = np.logaddexp(lp[:, BLANK], lp[:, SIL])
    lp[:, SIL] = -1e9
    return lp


def ctc_viterbi(lp: np.ndarray, seq: list[int]) -> list[list[int]]:
    """CTC 强制对齐（按状态维向量化），返回每个目标音素占用的帧下标。"""
    T, S = lp.shape[0], 2 * len(seq) + 1
    ext = np.array([BLANK if s % 2 == 0 else seq[s // 2] for s in range(S)])
    skip_ok = np.zeros(S, dtype=bool)
    skip_ok[2:] = (ext[2:] != BLANK) & (ext[2:] != ext[:-2])
    NEG = -1e18
    emit = lp[:, ext]
    dp = np.full(S, NEG)
    dp[0] = emit[0, 0]
    if S > 1:
        dp[1] = emit[0, 1]
    bp = np.zeros((T, S), dtype=np.int32)
    idx = np.arange(S)
    for t in range(1, T):
        stay = dp
        step = np.r_[NEG, dp[:-1]]
        jump = np.where(skip_ok, np.r_[NEG, NEG, dp[:-2]], NEG)
        cand = np.stack([stay, step, jump])
        k = cand.argmax(axis=0)
        bp[t] = idx - k
        dp = cand[k, idx] + emit[t]
    s = S - 1 if S == 1 or dp[S - 1] >= dp[S - 2] else S - 2
    frames: list[list[int]] = [[] for _ in seq]
    for t in range(T - 1, -1, -1):
        if s % 2 == 1:
            frames[s // 2].append(t)
        s = bp[t, s]
    return frames


def af_gop(lp: np.ndarray, seq: list[int]) -> np.ndarray:
    """免对齐 GOP：对每个位置构造替换/删除变体，用 CTC 前向概率比较。"""
    variants = [seq]
    owner = [-1]
    for i, p in enumerate(seq):
        for q in PID:
            if q != p:
                variants.append(seq[:i] + [q] + seq[i + 1 :])
                owner.append(i)
        variants.append(seq[:i] + seq[i + 1 :])
        owner.append(i)
    T = lp.shape[0]
    logp = torch.from_numpy(lp).float().unsqueeze(1).expand(T, len(variants), lp.shape[1])
    L = max(len(v) for v in variants)
    tgt = torch.full((len(variants), max(L, 1)), BLANK, dtype=torch.long)
    for k, v in enumerate(variants):
        if v:
            tgt[k, : len(v)] = torch.tensor(v)
    nll = F.ctc_loss(
        logp,
        tgt,
        torch.full((len(variants),), T, dtype=torch.long),
        torch.tensor([len(v) for v in variants]),
        blank=BLANK,
        reduction="none",
        zero_infinity=False,
    ).numpy()
    ll = -nll
    canon = ll[0]
    owner = np.array(owner)
    out = np.zeros(len(seq))
    for i in range(len(seq)):
        comp = ll[owner == i]
        comp = comp[np.isfinite(comp)]
        out[i] = canon - np.logaddexp.reduce(np.concatenate([[canon], comp]))
    return out


def pearson(a, b) -> float:
    a, b = np.asarray(a, float), np.asarray(b, float)
    return float(np.corrcoef(a, b)[0, 1])


def auc(scores, labels) -> float:
    """labels=1 表示发音错误；分数越低越可能错。"""
    s, y = -np.asarray(scores, float), np.asarray(labels, int)
    order = np.argsort(s)
    ranks = np.empty(len(s))
    ranks[order] = np.arange(1, len(s) + 1)
    pos = y.sum()
    return float((ranks[y == 1].sum() - pos * (pos + 1) / 2) / (pos * (len(y) - pos)))


def greedy(lp: np.ndarray) -> list[int]:
    ids = lp.argmax(axis=1)
    out, prev = [], -1
    for i in ids:
        if i != prev and i not in (BLANK, SIL):
            out.append(int(i))
        prev = i
    return out


def edit(a: list[int], b: list[int]) -> int:
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
    return d[-1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--logits", default="int8")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--split", default="test")
    a = ap.parse_args()
    pre = "" if a.split == "test" else a.split + "_"

    z = np.load(CACHE / f"logits_{pre}{a.logits}.npz")
    rows = pq.read_table(CACHE / "data" / f"so762_{a.split}.parquet", columns=["accuracy", "words", "age", "speaker"]).to_pylist()
    n = min(len(z.files), a.limit or 10**9)

    feats, human, utt_rows, per_err, per_len = [], [], [], 0, 0
    phone_ids, utt_ids = [], []
    for i in range(n):
        lp = fold_sil(z[f"u{i}"])
        r = rows[i]
        seq, hs, word_idx = [], [], []
        for wi, w in enumerate(r["words"]):
            for p, h in zip(w["phones"], w["phones-accuracy"]):
                p = re.sub(r"\d", "", p)
                if p not in VOCAB:
                    continue
                seq.append(VOCAB[p])
                hs.append(h)
                word_idx.append(wi)
        if not seq or lp.shape[0] < len(seq):
            continue
        frames = ctc_viterbi(lp, seq)
        af = af_gop(lp, seq)
        masked = lp.copy()
        for k, (p, fr) in enumerate(zip(seq, frames)):
            fr = fr or [0]
            canon = lp[fr, p]
            masked_fr = masked[fr].copy()
            masked_fr[:, [p, BLANK, SIL]] = -1e9
            comp = masked_fr.max(axis=1)
            feats.append([canon.mean(), (canon - comp).mean(), af[k], len(fr)])
            human.append(hs[k])
            phone_ids.append(p)
            utt_ids.append(i)
        g = greedy(lp)
        if r["accuracy"] >= 9:  # 只在发音好的句子上算 PER，衡量模型本身的识别力
            per_err += edit(g, seq)
            per_len += len(seq)
        utt_rows.append({"i": i, "acc": r["accuracy"], "age": r["age"], "spk": r["speaker"], "af": af, "h": hs, "words": word_idx, "nw": len(r["words"]), "wacc": [w["accuracy"] for w in r["words"]]})
        if i % 250 == 0:
            print("scored", i, flush=True)

    feats = np.array(feats)
    human = np.array(human)
    # 落一份逐音素特征表，供 calibrate.py 训练/评估校准模型
    np.savez_compressed(
        CACHE / f"feats_{pre}{a.logits}.npz",
        feats=feats,
        human=human,
        phone=np.array(phone_ids),
        utt=np.array(utt_ids),
        utt_acc=np.array([rows[u]["accuracy"] for u in utt_ids]),
        age=np.array([rows[u]["age"] for u in utt_ids]),
    )
    err = (human < 1.5).astype(int)  # 0=错/漏读, 1=重口音 → 视为需要纠正
    res = {"n_utts": len(utt_rows), "n_phones": len(human), "err_rate": round(float(err.mean()), 3), "PER_on_good_utts": round(per_err / max(per_len, 1), 3)}
    for k, name in enumerate(["lpp", "lpr", "af"]):
        res[f"phone_pcc_{name}"] = round(pearson(feats[:, k], human), 3)
        res[f"mdd_auc_{name}"] = round(auc(feats[:, k], err), 3)

    # 句子级：句内 af 均值 vs 人工句子准确度（0-10）
    utt_af = [np.mean(u["af"]) for u in utt_rows]
    res["utt_pcc_af"] = round(pearson(utt_af, [u["acc"] for u in utt_rows]), 3)
    adult = [k for k, u in enumerate(utt_rows) if u["age"] >= 16]
    res["n_adult_utts"] = len(adult)
    res["utt_pcc_af_adult"] = round(pearson([utt_af[k] for k in adult], [utt_rows[k]["acc"] for k in adult]), 3) if adult else None
    # 词级：词内 af 均值 vs 人工词准确度（0-10）
    wa, wh = [], []
    for u in utt_rows:
        w = np.array(u["words"])
        for wi in range(u["nw"]):
            m = w == wi
            if m.any():
                wa.append(u["af"][m].mean())
                wh.append(u["wacc"][wi])
    res["word_pcc_af"] = round(pearson(wa, wh), 3)

    # 简单组合：说话人分组 5 折交叉验证的线性回归（lpp/lpr/af/帧数），看组合能否再提高
    spk = np.array([u["spk"] for u in utt_rows for _ in u["h"]])
    X = np.c_[feats, np.ones(len(feats))]
    pred = np.zeros(len(human))
    uniq = np.unique(spk)
    rng = np.random.default_rng(0)
    folds = np.array_split(rng.permutation(uniq), 5)
    for f in folds:
        te = np.isin(spk, f)
        w, *_ = np.linalg.lstsq(X[~te], human[~te], rcond=None)
        pred[te] = X[te] @ w
    res["phone_pcc_combo_cv"] = round(pearson(pred, human), 3)
    res["mdd_auc_combo_cv"] = round(auc(pred, err), 3)

    # 红黄绿三档在 af 上的建议阈值：按人工 0/1/2 三类的中位数中点
    for lvl, lo, hi in [("red", -1, 0.5), ("yellow", 0.5, 1.5), ("green", 1.5, 3)]:
        m = (human > lo) & (human <= hi) if lvl != "red" else human <= hi
        res[f"af_median_{lvl}"] = round(float(np.median(feats[m, 2])), 3) if m.any() else None

    out = CACHE / f"eval_{pre}{a.logits}.json"
    out.write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

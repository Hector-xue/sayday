"""句子级评分实验：在逐音素校准分之外，加入“识别序列 vs 标准读音”的对齐特征（多读/漏读/替换），
看能否解决“加尾音不扣分、整句分虚高”的问题。

用法: .venv/bin/python spikes/m0/utt_score.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge

sys.path.insert(0, str(Path(__file__).parent))
import calibrate as c  # noqa: E402
import score_eval as se  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
VOWELS = {se.VOCAB[p] for p in ["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]}


def align_ops(hyp: list[int], ref: list[int]) -> dict:
    """编辑距离回溯，统计插入（尤其是插入元音）、删除、替换。"""
    n, m = len(ref), len(hyp)
    d = np.zeros((n + 1, m + 1), dtype=np.int32)
    d[:, 0] = np.arange(n + 1)
    d[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]))
    i, j = n, m
    ins = ins_v = dele = sub = 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i, j] == d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            sub += ref[i - 1] != hyp[j - 1]
            i, j = i - 1, j - 1
        elif j > 0 and d[i, j] == d[i, j - 1] + 1:
            ins += 1
            ins_v += hyp[j - 1] in VOWELS
            j -= 1
        else:
            dele += 1
            i -= 1
    return {"ins": ins, "ins_v": ins_v, "del": dele, "sub": sub}


def utt_table(split: str, phone_pred: np.ndarray, feats) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    pre = "train_" if split == "train" else ""
    z = np.load(CACHE / f"logits_{pre}int8.npz")
    rows = pq.read_table(CACHE / "data" / f"so762_{split}.parquet", columns=["accuracy", "words", "age"]).to_pylist()
    X, y, age = [], [], []
    utt = feats["utt"]
    for i in np.unique(utt):
        lp = se.fold_sil(z[f"u{i}"])
        ref = [se.VOCAB[re.sub(r"\d", "", p)] for w in rows[i]["words"] for p in w["phones"] if re.sub(r"\d", "", p) in se.VOCAB]
        ops = align_ops(se.greedy(lp), ref)
        p = phone_pred[utt == i]
        n = len(ref)
        dur = lp.shape[0] * 0.02
        X.append([p.mean(), p.min(), np.mean(p < 1.4), ops["ins"] / n, ops["ins_v"] / n, ops["del"] / n, ops["sub"] / n, n / dur])
        y.append(rows[i]["accuracy"])
        age.append(rows[i]["age"])
    return np.array(X), np.array(y, float), np.array(age)


def main() -> None:
    tr = np.load(CACHE / "feats_train_int8.npz")
    te = np.load(CACHE / "feats_int8.npz")
    lite = lambda z: (lambda X: np.c_[X[:, 2], X[:, 4], X[:, 5:]])(c.design(z))  # noqa: E731
    # 训练集的逐音素预测用 5 折交叉得到，避免句子级模型吃到过拟合的音素分
    ptr = np.zeros(len(tr["human"]))
    spk_fold = tr["utt"] % 5
    for k in range(5):
        m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, random_state=0)
        m.fit(lite(tr)[spk_fold != k], tr["human"][spk_fold != k])
        ptr[spk_fold == k] = m.predict(lite(tr)[spk_fold == k])
    full = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, random_state=0).fit(lite(tr), tr["human"])
    pte = full.predict(lite(te))

    Xtr, ytr, _ = utt_table("train", ptr, tr)
    Xte, yte, age = utt_table("test", pte, te)
    res = {}
    for name, cols in [("仅音素分均值", [0]), ("音素分统计", [0, 1, 2]), ("+对齐特征(多读/漏读/替换)", list(range(7))), ("+语速", list(range(8)))]:
        r = Ridge(alpha=1.0).fit(Xtr[:, cols], ytr)
        g = HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05, random_state=0).fit(Xtr[:, cols], ytr)
        pr, pg = r.predict(Xte[:, cols]), g.predict(Xte[:, cols])
        res[name] = {
            "ridge_pcc": round(float(np.corrcoef(pr, yte)[0, 1]), 3),
            "gbdt_pcc": round(float(np.corrcoef(pg, yte)[0, 1]), 3),
            "gbdt_pcc_adult": round(float(np.corrcoef(pg[age >= 16], yte[age >= 16])[0, 1]), 3),
        }
    g = HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05, random_state=0).fit(Xtr, ytr)
    ids = list(np.unique(te["utt"]))
    res["例句340(人工4/10)"] = round(float(g.predict(Xte[[ids.index(340)]])[0]), 1)
    (CACHE / "utt_score_result.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

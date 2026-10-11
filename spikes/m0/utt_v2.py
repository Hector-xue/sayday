"""句子级评分 v2：音素校准分统计 + 词尾似然比（加尾音/漏尾音）+ 语速 → 线性模型，导出给前端。

特征全部是前端能算出来的（gop.mjs 的 afGop/tailLLR + calib.mjs），所以线性权重可以直接写进 calib.json。
用法: .venv/bin/python spikes/m0/utt_v2.py
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
import tail_llr as tl  # noqa: E402
from tail_detect import VOWELS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
INS_TH, DEL_TH = 3.0, 5.0
FEATURES = ["音素分均值", "音素分最小值", "低于1.4的比例", "加尾音词比例", "漏尾音词比例", "加尾音LLR正部均值", "每音素帧数"]


def lite(z):
    X = c.design(z)
    return np.c_[X[:, 2], X[:, 4], X[:, 5:]]


def phone_preds(tr, te):
    """测试集用全量模型；训练集用 5 折交叉预测，避免句子级模型学到过拟合的音素分。"""
    ptr = np.zeros(len(tr["human"]))
    fold = tr["utt"] % 5
    Xtr = lite(tr)
    for k in range(5):
        m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, random_state=0)
        m.fit(Xtr[fold != k], tr["human"][fold != k])
        ptr[fold == k] = m.predict(Xtr[fold == k])
    full = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, random_state=0).fit(Xtr, tr["human"])
    return ptr, full.predict(lite(te))


def table(split: str, feats, pred) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    cache = CACHE / f"utt_v2_{split}.npz"
    pre = "train_" if split == "train" else ""
    rows = pq.read_table(CACHE / "data" / f"so762_{split}.parquet", columns=["accuracy", "words", "age"]).to_pylist()
    if cache.exists():
        tail = dict(np.load(cache, allow_pickle=True))["tail"].item()
    else:
        z = np.load(CACHE / f"logits_{pre}int8.npz")
        tail = {}
        for i in np.unique(feats["utt"]):
            ref, wo = [], []
            for wi, w in enumerate(rows[i]["words"]):
                for p in w["phones"]:
                    p = re.sub(r"\d", "", p)
                    if p in se.VOCAB:
                        ref.append(se.VOCAB[p])
                        wo.append(wi)
            lp = se.fold_sil(z[f"u{i}"])
            tail[int(i)] = (list(tl.tail_llr(lp, ref, wo).values()), lp.shape[0], len(ref), len(rows[i]["words"]))
            if i % 500 == 0:
                print(split, i, flush=True)
        np.savez(cache, tail=np.array(tail, dtype=object))
    X, y, age = [], [], []
    for i in np.unique(feats["utt"]):
        p = pred[feats["utt"] == i]
        llr, T, nph, nw = tail[int(i)]
        ins = np.array([a for a, _ in llr]) if llr else np.zeros(0)
        dele = np.array([b for _, b in llr]) if llr else np.zeros(0)
        X.append([p.mean(), p.min(), np.mean(p < 1.4), (ins > INS_TH).sum() / nw, (dele > DEL_TH).sum() / nw, np.clip(ins, 0, None).mean() if len(ins) else 0.0, T / nph])
        y.append(rows[i]["accuracy"])
        age.append(rows[i]["age"])
    return np.array(X), np.array(y, float), np.array(age)


def main() -> None:
    tr = np.load(CACHE / "feats_train_int8.npz")
    te = np.load(CACHE / "feats_int8.npz")
    ptr, pte = phone_preds(tr, te)
    Xtr, ytr, _ = table("train", tr, ptr)
    Xte, yte, age = table("test", te, pte)
    res = {}
    for name, cols in [("仅音素分均值", [0]), ("音素分统计", [0, 1, 2]), ("+词尾检测", [0, 1, 2, 3, 4, 5]), ("+语速（全部）", list(range(7)))]:
        r = Ridge(alpha=1.0).fit(Xtr[:, cols], ytr)
        p = r.predict(Xte[:, cols])
        res[name] = {"pcc": round(float(np.corrcoef(p, yte)[0, 1]), 3), "pcc_成人": round(float(np.corrcoef(p[age >= 16], yte[age >= 16])[0, 1]), 3)}
    r = Ridge(alpha=1.0).fit(Xtr, ytr)
    ids = list(np.unique(te["utt"]))
    res["例句340(人工4/10)"] = round(float(r.predict(Xte[[ids.index(340)]])[0]), 1)
    res["例句0(人工9/10)"] = round(float(r.predict(Xte[[ids.index(0)]])[0]), 1)
    model = {"features": FEATURES, "coef": r.coef_.round(5).tolist(), "intercept": round(float(r.intercept_), 5), "insTh": INS_TH, "delTh": DEL_TH}
    p = ROOT / "spikes" / "m0" / "web" / "samples" / "calib.json"
    calib = json.loads(p.read_text())
    calib["utt"] = model
    p.write_text(json.dumps(calib, separators=(",", ":")))
    (CACHE / "utt_v2_result.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps(model, ensure_ascii=False))


if __name__ == "__main__":
    main()

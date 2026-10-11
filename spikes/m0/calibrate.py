"""用训练集拟合轻量校准模型（GOP 特征 → 人工 0–2 分），在测试集上评估。

两种模型：
  ridge  线性回归，权重可直接写进前端 TS（几十个数字）
  gbdt   直方图梯度提升树，作为精度上限参考
用法: .venv/bin/python spikes/m0/calibrate.py --train int8 --test int8 [--test int8_silk]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import f1_score, roc_auc_score

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
NPH = 42


def design(z) -> np.ndarray:
    f = z["feats"].astype(np.float64)
    lpp = np.clip(f[:, 0], -20, 0)
    lpr = np.clip(f[:, 1], -20, 20)
    af = np.clip(f[:, 2], -20, 0)
    dur = np.log1p(f[:, 3])
    # 句内上下文：同一句的 af 均值（反映整体口音/录音条件）
    utt = z["utt"]
    _, inv = np.unique(utt, return_inverse=True)
    utt_mean = np.bincount(inv, af) / np.bincount(inv)
    onehot = np.eye(NPH)[z["phone"]]
    return np.c_[lpp, lpr, af, dur, utt_mean[inv], onehot]


def metrics(pred, human, age) -> dict:
    err = (human < 1.5).astype(int)
    # 选在训练集外的固定阈值 1.5 上算 F1，同时给最优阈值下的 F1 作参考
    best = max((f1_score(err, (pred < t).astype(int)), t) for t in np.linspace(0.8, 1.9, 23))
    adult = age >= 16
    return {
        "phone_pcc": round(float(np.corrcoef(pred, human)[0, 1]), 3),
        "phone_pcc_adult": round(float(np.corrcoef(pred[adult], human[adult])[0, 1]), 3),
        "mdd_auc": round(float(roc_auc_score(err, -pred)), 3),
        "mdd_f1_at_1.5": round(float(f1_score(err, (pred < 1.5).astype(int))), 3),
        "mdd_f1_best": round(float(best[0]), 3),
        "best_threshold": round(float(best[1]), 2),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", default="int8")
    ap.add_argument("--test", action="append", default=None)
    a = ap.parse_args()
    tests = a.test or ["int8"]

    tr = np.load(CACHE / f"feats_train_{a.train}.npz")
    Xtr, ytr = design(tr), tr["human"]
    ridge = Ridge(alpha=1.0).fit(Xtr, ytr)
    gbdt = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, random_state=0).fit(Xtr, ytr)

    res = {"train_phones": int(len(ytr))}
    for t in tests:
        te = np.load(CACHE / f"feats_{t}.npz")
        Xte, yte, age = design(te), te["human"], te["age"]
        res[t] = {
            "n_phones": int(len(yte)),
            "raw_af": metrics(np.clip(te["feats"][:, 2], -20, 0), yte, age) | {"note": "未校准的 af 分数，阈值无意义只看 PCC/AUC"},
            "ridge": metrics(ridge.predict(Xte), yte, age),
            "gbdt": metrics(gbdt.predict(Xte), yte, age),
        }
        # 句子级：校准后音素分取均值 vs 人工句子准确度
        p = gbdt.predict(Xte)
        utt = te["utt"]
        _, inv = np.unique(utt, return_inverse=True)
        um = np.bincount(inv, p) / np.bincount(inv)
        ua = np.bincount(inv, te["utt_acc"]) / np.bincount(inv)
        res[t]["utt_pcc_gbdt"] = round(float(np.corrcoef(um, ua)[0, 1]), 3)

    w = {"coef": ridge.coef_.round(5).tolist(), "intercept": round(float(ridge.intercept_), 5)}
    (CACHE / "ridge_weights.json").write_text(json.dumps(w))
    (CACHE / "calibrate_result.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

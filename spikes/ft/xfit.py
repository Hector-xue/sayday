"""交叉拟合校准：校准数据从一半说话人翻倍到整个训练集，并换成用全部训练集微调的模型。

现在线上（ft1）：模型只用 A 半微调，校准只能用 B 半（用模型见过的句子校准会学到“过于自信”的分布）。
交叉拟合：再训一个只用 B 半的模型 ftB。
  A 半的特征用 ftB 算、B 半的特征用 ft（A 半模型）算——两边都是“没见过的说话人”，合起来 2500 句都能用来校准；
  最终上线的模型用整个训练集微调（ftall），用这份校准。测试集（官方 test，谁都没见过）上和现在线上的方案对比。

需要（都在 .cache/ 下）：
  feats_trainA_ftB_int8.npz  logits_trainA_ftB_int8.npz    ftB 在 A 半上
  feats_trainB_ft_int8.npz   logits_trainB_ft_int8.npz     ft（A 半模型）在 B 半上
  feats_ft_int8.npz          logits_ft_int8.npz            ft 在测试集上（现在线上的对照）
  feats_ftall_int8.npz       logits_ftall_int8.npz         ftall 在测试集上（候选）
  data/so762_trainA.parquet、so762_trainB.parquet、so762_test.parquet
产物: .cache/ft/xfit.json（对比结果）、.cache/ft/calib.xfit.json（候选校准表，格式同 packages/speech/calib.json）
用法: python spikes/ft/xfit.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
sys.path.insert(0, str(ROOT / "spikes" / "m0"))
import calibrate as c  # noqa: E402
import utt_v2 as u  # noqa: E402

RED, YELLOW = 0.8, 1.4
GB = dict(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, random_state=0)


def lite(z) -> np.ndarray:
    X = c.design(z)
    return np.c_[X[:, 2], X[:, 4], X[:, 5:]]


def phone_metrics(p: np.ndarray, te) -> dict:
    h = te["human"]
    return c.metrics(p, h, te["age"]) | {
        "good_marked_red": round(float(np.mean(p[h >= 2] < RED)), 4),
        "bad_caught": round(float(np.mean(p[h < 0.5] < YELLOW)), 4),
    }


def cross_pred(X: np.ndarray, y: np.ndarray, groups: np.ndarray) -> np.ndarray:
    """训练集上的音素分用 5 折交叉预测（按句子分折），句子级模型才不会学到过拟合的音素分"""
    out = np.zeros(len(y))
    fold = groups % 5
    for k in range(5):
        m = HistGradientBoostingRegressor(**GB).fit(X[fold != k], y[fold != k])
        out[fold == k] = m.predict(X[fold == k])
    return out


def utt_pcc(Xtr, ytr, Xte, yte, age) -> dict:
    r = Ridge(alpha=1.0).fit(Xtr, ytr)
    p = r.predict(Xte)
    return {"utt_pcc": round(float(np.corrcoef(p, yte)[0, 1]), 3), "utt_pcc_adult": round(float(np.corrcoef(p[age >= 16], yte[age >= 16])[0, 1]), 3)}, r


def dump_trees(m: HistGradientBoostingRegressor) -> list:
    trees = []
    for pred in m._predictors:
        nodes = pred[0].nodes
        trees.append([[int(n["is_leaf"]), int(n["feature_idx"]), float(n["num_threshold"]), int(n["missing_go_to_left"]), int(n["left"]), int(n["right"]), round(float(n["value"]), 6)] for n in nodes])
    return trees


def main() -> None:
    trA = np.load(CACHE / "feats_trainA_ftB_int8.npz")
    trB = np.load(CACHE / "feats_trainB_ft_int8.npz")
    res = {}

    # 对照：现在线上的做法（ft + B 半校准），测试集用 ft 的特征
    te_ft = np.load(CACHE / "feats_ft_int8.npz")
    mB = HistGradientBoostingRegressor(**GB).fit(lite(trB), trB["human"])
    pB = cross_pred(lite(trB), trB["human"], trB["utt"])
    XB, yB, _ = u.table("trainB", trB, pB, "ft_int8")
    Xte, yte, age = u.table("test", te_ft, mB.predict(lite(te_ft)), "ft_int8")
    um, _ = utt_pcc(XB, yB, Xte, yte, age)
    res["线上 ft1（A 半微调，B 半校准）"] = phone_metrics(mB.predict(lite(te_ft)), te_ft) | um

    # 交叉拟合：A 半（ftB 的特征）+ B 半（ft 的特征）一起校准
    Xph = np.r_[lite(trA), lite(trB)]
    yph = np.r_[trA["human"], trB["human"]]
    mX = HistGradientBoostingRegressor(**GB).fit(Xph, yph)
    offset = int(trA["utt"].max()) + 1
    pX = cross_pred(Xph, yph, np.r_[trA["utt"], trB["utt"] + offset])
    nA = len(trA["human"])
    XA, yA, _ = u.table("trainA", trA, pX[:nA], "ftB_int8")
    XB2, yB2, _ = u.table("trainB", trB, pX[nA:], "ft_int8")
    Xutt, yutt = np.r_[XA, XB2], np.r_[yA, yB2]

    # 同一个模型 ft、只换成交叉拟合校准：看校准数据翻倍本身带来多少
    Xte, yte, age = u.table("test", te_ft, mX.predict(lite(te_ft)), "ft_int8")
    um, _ = utt_pcc(Xutt, yutt, Xte, yte, age)
    res["ft1 + 交叉拟合校准"] = phone_metrics(mX.predict(lite(te_ft)), te_ft) | um

    # 候选：全训练集微调的 ftall + 交叉拟合校准
    te_all = np.load(CACHE / "feats_ftall_int8.npz")
    Xte, yte, age = u.table("test", te_all, mX.predict(lite(te_all)), "ftall_int8")
    um, ridge = utt_pcc(Xutt, yutt, Xte, yte, age)
    res["ftall（全训练集微调）+ 交叉拟合校准"] = phone_metrics(mX.predict(lite(te_all)), te_all) | um

    (CACHE / "ft").mkdir(exist_ok=True)
    (CACHE / "ft" / "xfit.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    calib = {
        "features": ["af(clip -20..0)", "utt_mean_af", "phone_onehot[42]"],
        "baseline": float(np.ravel(mX._baseline_prediction)[0]),
        "trees": dump_trees(mX),
        "thresholds": {"red": RED, "yellow": YELLOW},
        "utt": {"features": u.FEATURES, "coef": ridge.coef_.round(5).tolist(), "intercept": round(float(ridge.intercept_), 5), "insTh": u.INS_TH, "delTh": u.DEL_TH},
    }
    (CACHE / "ft" / "calib.xfit.json").write_text(json.dumps(calib, separators=(",", ":")))

    keys = ["phone_pcc", "phone_pcc_adult", "mdd_auc", "good_marked_red", "bad_caught", "utt_pcc", "utt_pcc_adult"]
    print("| 方案 | " + " | ".join(keys) + " |")
    print("|---|" + "---|" * len(keys))
    for k, m in res.items():
        print(f"| {k} | " + " | ".join(str(m[x]) for x in keys) + " |")


if __name__ == "__main__":
    main()

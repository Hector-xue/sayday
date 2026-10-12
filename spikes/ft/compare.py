"""原模型 vs 微调后：同一套校准流程、同一份数据，比打分和人工评分的一致程度。

校准只用训练集 B 半（微调没见过的说话人），测试集是 speechocean762 官方测试集（微调和校准都没见过）。
App 实际用的是“轻量校准”（只用 af、句内均值、音素 id，见 spikes/m0/export_calib.py），所以以 lite 那行为准。

用法:
  python spikes/ft/compare.py prep             # 生成 .cache/data/so762_trainA.parquet、so762_trainB.parquet
  python spikes/ft/compare.py report int8 ft_int8
产物: .cache/ft/compare.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
from sklearn.ensemble import HistGradientBoostingRegressor

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
sys.path.insert(0, str(ROOT / "spikes" / "m0"))
sys.path.insert(0, str(Path(__file__).parent))
import calibrate as c  # noqa: E402

RED, YELLOW = 0.8, 1.4  # 和 App 的 calib.json 阈值一致


def prep() -> None:
    from train import speakers_split

    t = pq.read_table(CACHE / "data" / "so762_train.parquet")
    a, b = speakers_split(t.select(["speaker"]).to_pylist())
    for name, keep in (("trainA", a), ("trainB", b)):
        part = t.filter([s in keep for s in t.column("speaker").to_pylist()])
        pq.write_table(part, CACHE / "data" / f"so762_{name}.parquet")
        print(name, part.num_rows, "句")


def lite(z) -> np.ndarray:
    X = c.design(z)
    return np.c_[X[:, 2], X[:, 4], X[:, 5:]]


def one(tag: str) -> dict:
    tr = np.load(CACHE / f"feats_trainB_{tag}.npz")
    te = np.load(CACHE / f"feats_{tag}.npz")
    out = {}
    for name, f in (("lite", lite), ("full", c.design)):
        m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, random_state=0).fit(f(tr), tr["human"])
        p = m.predict(f(te))
        h = te["human"]
        _, inv = np.unique(te["utt"], return_inverse=True)
        um = np.bincount(inv, p) / np.bincount(inv)
        ua = np.bincount(inv, te["utt_acc"]) / np.bincount(inv)
        out[name] = c.metrics(p, h, te["age"]) | {
            "utt_pcc": round(float(np.corrcoef(um, ua)[0, 1]), 3),
            # 读对的音被标红的比例（误报，越低越好）
            "good_marked_red": round(float(np.mean(p[h >= 2] < RED)), 4),
            # 人工判 0 分（读错）的音被标红或标黄的比例（查出率，越高越好）
            "bad_caught": round(float(np.mean(p[h < 0.5] < YELLOW)), 4),
        }
    return out


def report(tags: list[str]) -> None:
    res = {t: one(t) for t in tags}
    (CACHE / "ft").mkdir(exist_ok=True)
    (CACHE / "ft" / "compare.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    keys = ["phone_pcc", "phone_pcc_adult", "utt_pcc", "mdd_auc", "good_marked_red", "bad_caught"]
    print("| 模型 | 校准 | " + " | ".join(keys) + " |")
    print("|---|---|" + "---|" * len(keys))
    for t, r in res.items():
        for name, m in r.items():
            print(f"| {t} | {name} | " + " | ".join(str(m[k]) for k in keys) + " |")


if __name__ == "__main__":
    if sys.argv[1] == "prep":
        prep()
    else:
        report(sys.argv[2:])

"""训练前端用的校准模型（仅免对齐特征：af、句内 af 均值、音素 id），导出为 JSON 供 JS 推理。

用法: .venv/bin/python spikes/m0/export_calib.py
产物: spikes/m0/web/samples/calib.json，.cache/calib_check.json（JS 对拍用的测试集样本）
"""
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, str(Path(__file__).parent))
import calibrate as c  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def lite(z):
    X = c.design(z)
    return np.c_[X[:, 2], X[:, 4], X[:, 5:]]


tr = np.load(ROOT / ".cache" / "feats_train_int8.npz")
te = np.load(ROOT / ".cache" / "feats_int8.npz")
m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, random_state=0).fit(lite(tr), tr["human"])

trees = []
for pred in m._predictors:
    nodes = pred[0].nodes
    # 每个节点: [是否叶子, 特征下标, 阈值, 缺失值走左, 左, 右, 叶子值]
    trees.append([[int(n["is_leaf"]), int(n["feature_idx"]), float(n["num_threshold"]), int(n["missing_go_to_left"]), int(n["left"]), int(n["right"]), round(float(n["value"]), 6)] for n in nodes])
out = {
    "features": ["af(clip -20..0)", "utt_mean_af", "phone_onehot[42]"],
    "baseline": float(np.ravel(m._baseline_prediction)[0]),
    "trees": trees,
    "thresholds": {"red": 0.8, "yellow": 1.4},
}
p = ROOT / "spikes" / "m0" / "web" / "samples" / "calib.json"
p.write_text(json.dumps(out, separators=(",", ":")))
X = lite(te)
idx = np.random.default_rng(0).choice(len(X), 2000, replace=False)
(ROOT / ".cache" / "calib_check.json").write_text(json.dumps({"X": X[idx].round(6).tolist(), "y": m.predict(X[idx].round(6)).tolist()}))
print(p.name, round(p.stat().st_size / 1e3), "KB", len(trees), "trees")

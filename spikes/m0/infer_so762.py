"""对 speechocean762 测试集跑音素 CTC 模型，缓存 logits，并测推理耗时。

用法: .venv/bin/python spikes/m0/infer_so762.py --model int8 [--limit N] [--threads 1] [--codec silk]
产物: .cache/logits_<model>[_<codec>].npz  （每条 utterance 的 log-softmax 后验）
      .cache/latency_<model>[_<codec>].json
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pyarrow.parquet as pq
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"


def load_rows(limit: int | None, split: str = "test"):
    t = pq.read_table(CACHE / "data" / f"so762_{split}.parquet")
    if limit:
        t = t.slice(0, limit)
    return t.to_pylist()


SILK_KBPS: list[float] = []


def silk_roundtrip(wav: np.ndarray, sr: int) -> np.ndarray:
    """经微信同款 silk 编解码走一遍（Node 侧 silk-wasm），模拟微信语音的音质损失。

    微信语音一般是 24kHz SILK，所以先升到 24k 编解码，再降回 16k 给模型。
    """
    from scipy.signal import resample_poly

    up = resample_poly(wav, 3, 2)
    with tempfile.TemporaryDirectory() as d:
        src, dst = Path(d) / "in.pcm", Path(d) / "out.pcm"
        (np.clip(up, -1, 1) * 32767).astype("<i2").tofile(src)
        p = subprocess.run(
            ["node", str(ROOT / "spikes" / "m0" / "silk_roundtrip.mjs"), str(src), str(dst), "24000"],
            check=True,
            capture_output=True,
            text=True,
        )
        SILK_KBPS.append(json.loads(p.stdout)["kbps"])
        dec = np.fromfile(dst, dtype="<i2").astype(np.float32) / 32768.0
    out = resample_poly(dec, 2, 3).astype(np.float32)
    return out[: len(wav)]


def normalize(wav: np.ndarray) -> np.ndarray:
    return (wav - wav.mean()) / np.sqrt(wav.var() + 1e-7)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["fp32", "int8"], default="int8")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--threads", type=int, default=1)
    ap.add_argument("--codec", choices=["none", "silk"], default="none")
    ap.add_argument("--split", choices=["test", "train"], default="test")
    ap.add_argument("--no-norm", action="store_true", help="不做零均值单位方差归一化")
    a = ap.parse_args()

    so = ort.SessionOptions()
    so.intra_op_num_threads = a.threads
    so.inter_op_num_threads = 1
    sess = ort.InferenceSession(str(CACHE / "models" / f"phone_ctc.{a.model}.onnx"), so, providers=["CPUExecutionProvider"])

    rows = load_rows(a.limit, a.split)
    out, lat = {}, []
    for i, r in enumerate(rows):
        wav, sr = sf.read(io.BytesIO(r["audio"]["bytes"]), dtype="float32")
        if wav.ndim > 1:
            wav = wav.mean(axis=1)
        assert sr == 16000, sr
        if a.codec == "silk":
            wav = silk_roundtrip(wav, sr)
        x = wav if a.no_norm else normalize(wav)
        t0 = time.perf_counter()
        logits = sess.run(None, {"input_values": x[None, :].astype(np.float32)})[0][0]
        dt = time.perf_counter() - t0
        lat.append({"audio_s": len(wav) / sr, "infer_s": dt})
        m = logits.max(axis=1, keepdims=True)
        logp = logits - m - np.log(np.exp(logits - m).sum(axis=1, keepdims=True))
        out[f"u{i}"] = logp.astype(np.float16)
        if i % 250 == 0:
            print(i, f"{len(wav)/sr:.1f}s audio -> {dt*1000:.0f}ms", flush=True)

    tag = ("train_" if a.split == "train" else "") + a.model + ("" if a.codec == "none" else f"_{a.codec}") + ("_nonorm" if a.no_norm else "")
    np.savez_compressed(CACHE / f"logits_{tag}.npz", **out)
    audio = np.array([x["audio_s"] for x in lat])
    infer = np.array([x["infer_s"] for x in lat])
    summary = {
        "model": a.model,
        "codec": a.codec,
        "threads": a.threads,
        "n": len(lat),
        "audio_mean_s": round(float(audio.mean()), 2),
        "infer_p50_ms": round(float(np.median(infer)) * 1000),
        "infer_p95_ms": round(float(np.percentile(infer, 95)) * 1000),
        "rtf_mean": round(float((infer / audio).mean()), 3),
    }
    if SILK_KBPS:
        summary["silk_kbps_mean"] = round(float(np.mean(SILK_KBPS)), 1)
    (CACHE / f"latency_{tag}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()

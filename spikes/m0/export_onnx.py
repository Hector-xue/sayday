"""把 charsiu 音素 CTC 模型导出为 ONNX（fp32 + int8 动态量化）。

用法: .venv/bin/python spikes/m0/export_onnx.py [--ckpt .cache/ft/ckpt.pt --name ft_]
产物: .cache/models/phone_ctc.fp32.onnx, phone_ctc.int8.onnx
"""
import argparse
from pathlib import Path

import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import Wav2Vec2Config, Wav2Vec2ForCTC

ROOT = Path(__file__).resolve().parents[2]
M = ROOT / ".cache" / "models"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", type=Path, help="微调检查点（spikes/ft/train.py 的 ckpt.pt）；不给就导出原始 charsiu 权重")
    ap.add_argument("--name", default="", help="产物名前缀：phone_ctc.<name>fp32.onnx / phone_ctc.<name>int8.onnx")
    a = ap.parse_args()
    cfg = Wav2Vec2Config.from_json_file(str(M / "charsiu_config.json"))
    model = Wav2Vec2ForCTC(cfg)
    state = torch.load(a.ckpt, map_location="cpu", weights_only=False)["model"] if a.ckpt else torch.load(M / "charsiu_ctc.bin", map_location="cpu", weights_only=True)
    missing, unexpected = model.load_state_dict(state, strict=False)
    # 位置卷积的 weight_g/weight_v 在新版 torch 里改名为 parametrizations，这里显式检查真正缺失的权重
    real_missing = [k for k in missing if "pos_conv" not in k]
    if real_missing or unexpected:
        raise SystemExit(f"权重不匹配: missing={real_missing[:5]} unexpected={unexpected[:5]}")
    model.eval()

    fp32 = M / f"phone_ctc.{a.name}fp32.onnx"
    dummy = torch.zeros(1, 16000)
    torch.onnx.export(
        model,
        (dummy,),
        str(fp32),
        input_names=["input_values"],
        output_names=["logits"],
        dynamic_axes={"input_values": {1: "samples"}, "logits": {1: "frames"}},
        opset_version=17,
        dynamo=False,
    )
    int8 = M / f"phone_ctc.{a.name}int8.onnx"
    # 只量化 MatMul：wav2vec2 的卷积特征提取层量化后精度掉得厉害
    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"])
    for p in (fp32, int8):
        print(p.name, round(p.stat().st_size / 1e6, 1), "MB")


if __name__ == "__main__":
    main()

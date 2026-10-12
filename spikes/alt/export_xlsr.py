"""charsiu 的备选：facebook/wav2vec2-xlsr-53-espeak-cv-ft（Apache-2.0，Common Voice 训练，授权明确）。

它输出的是 espeak 的国际音标（392 个符号，多语种），我们的打分用 charsiu 的 42 个音素（CMU 音标 + [SIL]/[UNK]/[PAD]）。
这里把模型包一层：softmax 之后按“国际音标 → CMU 音标”对应表把概率加到 42 个音素上，再取对数。
导出的 ONNX 输出就是 42 维对数概率，和 charsiu 模型的输出形状、顺序一样，App 和评测脚本都能直接换着用。
对应表只管英语（espeak en-us 用到的符号）；其他语言的符号都算 [UNK]。带 r 的复合元音（ɑːɹ 之类）只能算进前一个音。

用法: python spikes/alt/export_xlsr.py
产物: .cache/models/phone_ctc.xlsr_fp32.onnx、phone_ctc.xlsr_int8.onnx
"""
import json
from pathlib import Path

import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import Wav2Vec2ForCTC

ROOT = Path(__file__).resolve().parents[2]
M = ROOT / ".cache" / "models"
HF = "facebook/wav2vec2-xlsr-53-espeak-cv-ft"

IPA2CMU = {
    "ɑː": "AA", "ɑ": "AA", "ɑːɹ": "AA", "ɒ": "AA", "aː": "AA",
    "æ": "AE",
    "ʌ": "AH", "ə": "AH", "ɐ": "AH",
    "ɔː": "AO", "ɔ": "AO", "ɔːɹ": "AO",
    "aʊ": "AW",
    "aɪ": "AY", "aɪə": "AY", "aɪɚ": "AY",
    "ɛ": "EH", "ɛɹ": "EH", "e": "EH",
    "ɚ": "ER", "ɜː": "ER", "ɜ": "ER",
    "eɪ": "EY",
    "ɪ": "IH", "ᵻ": "IH", "ɪɹ": "IH",
    "iː": "IY", "i": "IY", "iə": "IY",
    "oʊ": "OW", "o": "OW", "oː": "OW", "əʊ": "OW", "oːɹ": "OW",
    "ɔɪ": "OY",
    "ʊ": "UH", "ʊɹ": "UH",
    "uː": "UW", "u": "UW",
    "b": "B", "tʃ": "CH", "d": "D", "ð": "DH", "f": "F", "ɡ": "G", "h": "HH", "dʒ": "JH", "k": "K",
    "l": "L", "əl": "L", "ɫ": "L", "m": "M", "n": "N", "n̩": "N", "ŋ": "NG", "p": "P", "ɹ": "R", "r": "R",
    "s": "S", "ʃ": "SH", "t": "T", "ɾ": "T", "ʔ": "T", "θ": "TH", "v": "V", "w": "W", "j": "Y", "z": "Z", "ʒ": "ZH",
}


class Mapped(torch.nn.Module):
    def __init__(self, model: Wav2Vec2ForCTC, mat: torch.Tensor):
        super().__init__()
        self.model = model
        self.register_buffer("mat", mat)

    def forward(self, x):
        p = torch.softmax(self.model(x).logits, dim=-1)
        return torch.log(p @ self.mat + 1e-8)


def main() -> None:
    from huggingface_hub import hf_hub_download
    src = json.loads(Path(hf_hub_download(HF, "vocab.json")).read_text())
    dst = json.loads((M / "charsiu_vocab.json").read_text())
    mat = torch.zeros(len(src), len(dst))
    unk, blank = dst["[UNK]"], dst["[PAD]"]
    for tok, i in src.items():
        if tok in ("<pad>", "<s>", "</s>"):
            mat[i, blank] = 1  # CTC 空白
        elif tok in IPA2CMU:
            mat[i, dst[IPA2CMU[tok]]] = 1
        else:
            mat[i, unk] = 1
    print("对应到英语音素的符号", sum(t in IPA2CMU for t in src), "/", len(src))
    model = Wav2Vec2ForCTC.from_pretrained(HF).eval()
    wrapped = Mapped(model, mat).eval()

    fp32 = M / "phone_ctc.xlsr_fp32.onnx"
    torch.onnx.export(
        wrapped, (torch.zeros(1, 16000),), str(fp32),
        input_names=["input_values"], output_names=["logits"],
        dynamic_axes={"input_values": {1: "samples"}, "logits": {1: "frames"}},
        opset_version=17, dynamo=False,
    )
    int8 = M / "phone_ctc.xlsr_int8.onnx"
    # 最后那一步“概率 × 对应表”不能量化：动态量化会把很小的概率量成 0，取对数后整列变成 -18
    import onnx
    g = onnx.load(str(fp32), load_external_data=False).graph
    shapes = {t.name: list(t.dims) for t in g.initializer}
    skip = [n.name for n in g.node if n.op_type == "MatMul" and any(shapes.get(i) == [len(src), len(dst)] for i in n.input)]
    print("不量化的节点", skip)
    assert skip, "没找到对应表那一步"
    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"], nodes_to_exclude=skip)
    for p in (fp32, int8):
        print(p.name, round(p.stat().st_size / 1e6, 1), "MB")


if __name__ == "__main__":
    main()

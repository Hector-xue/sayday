"""听学的中文讲解：zh_items.mjs 列出的中文 → sherpa-onnx 合成 → mp3（24kHz 单声道 48kbps：比 64k 小四分之一，频宽一样是满的 11kHz；32k 会切到 8kHz、齿音发闷，实测过）。
输出 <out>/zh/<键>.mp3，外加 <out>/zh/shard-<i>.json（清单）。
用法: python build_zh.py --items items.json --out out --shard 0 --model kokoro-multi-lang-v1_1 --sid 36 --speed 1.15
模型目录（sherpa-onnx 的 tts-models 发布包解开）：kokoro-multi-lang-v1_1（Kokoro v1.1-zh）或 matcha-icefall-zh-baker（另需 vocos-22khz-univ.onnx）
声音：sid 36（年龄模型估约 25 岁）、1.15 倍速（每秒约 3.8 个字）。原先的 sid 25 被用户说像中年人、偏慢，估出来 67 岁、每秒 3.1 字。
为什么不用手机自带的中文语音：各家手机的引擎参差不齐，用户反馈“电子音太重、机械、偶尔像青蛙叫”。
"""
import argparse, json, os, subprocess, sys, time

import numpy as np
import sherpa_onnx

ap = argparse.ArgumentParser()
ap.add_argument('--items', required=True)
ap.add_argument('--out', default='out')
ap.add_argument('--shard', type=int, default=0)
ap.add_argument('--model', required=True)
ap.add_argument('--sid', type=int, default=36)
ap.add_argument('--speed', type=float, default=1.15)
ap.add_argument('--threads', type=int, default=os.cpu_count() or 2)
a = ap.parse_args()

m = a.model.rstrip('/')
name = os.path.basename(m)
if name.startswith('kokoro'):
    model = sherpa_onnx.OfflineTtsModelConfig(kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
        model=f'{m}/model.onnx', voices=f'{m}/voices.bin', tokens=f'{m}/tokens.txt', data_dir=f'{m}/espeak-ng-data',
        dict_dir=f'{m}/dict', lexicon=f'{m}/lexicon-us-en.txt,{m}/lexicon-zh.txt'), num_threads=a.threads)
    fsts = f'{m}/date-zh.fst,{m}/phone-zh.fst,{m}/number-zh.fst'
elif name.startswith('matcha'):
    model = sherpa_onnx.OfflineTtsModelConfig(matcha=sherpa_onnx.OfflineTtsMatchaModelConfig(
        acoustic_model=f'{m}/model-steps-3.onnx', vocoder=f'{os.path.dirname(m) or "."}/vocos-22khz-univ.onnx',
        lexicon=f'{m}/lexicon.txt', tokens=f'{m}/tokens.txt', dict_dir=f'{m}/dict'), num_threads=a.threads)
    fsts = f'{m}/date.fst,{m}/phone.fst,{m}/number.fst'
else:
    sys.exit(f'不认识的模型：{m}')
tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=model, rule_fsts=fsts, max_num_sentences=1))

items = json.load(open(a.items, encoding='utf-8'))
out = os.path.join(a.out, 'zh')
os.makedirs(out, exist_ok=True)
done, bad = [], []
t0 = time.time()
for i, it in enumerate(items):
    g = tts.generate(it['say'], sid=a.sid, speed=a.speed)
    x = np.asarray(g.samples, dtype=np.float32)
    # 合成出来太短（几乎没声音）就是出错了：不发布，App 那边会用系统语音顶上
    if len(x) < g.sample_rate * 0.25 or float(np.max(np.abs(x))) < 0.01:
        bad.append(it['key']); continue
    pcm = (np.clip(x / max(1.0, float(np.max(np.abs(x)))), -1, 1) * 32767).astype('<i2').tobytes()
    dst = os.path.join(out, it['key'] + '.mp3')
    r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', str(g.sample_rate), '-ac', '1', '-i', '-',
                        '-af', 'aresample=24000:resampler=soxr', '-ar', '24000', '-ac', '1', '-b:a', '48k', dst], input=pcm)
    if r.returncode: bad.append(it['key']); continue
    done.append({'key': it['key'], 'text': it['text'], 'sec': round(len(x) / g.sample_rate, 2)})
    if i % 100 == 0:
        print(f'{i}/{len(items)} {time.time() - t0:.0f}s', flush=True)
json.dump({'shard': a.shard, 'model': name, 'sid': a.sid, 'speed': a.speed, 'items': done, 'bad': bad}, open(os.path.join(out, f'shard-{a.shard}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(f'合成 {len(done)} 句，失败 {len(bad)} 句，{time.time() - t0:.0f}s')
if len(bad) > max(5, len(items) // 50):
    sys.exit('失败太多')

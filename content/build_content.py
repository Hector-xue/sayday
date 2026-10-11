"""构建离线内容包：词表（ECDICT）+ 例句（Tatoeba 中英句对）→ content/pack/*.json

  words.json      [[词, 词频排名, 估算CEFR, 音标, 释义, 考试标签, CMU音素, 敏感(0/1)], ...]（按排名）
  sentences.json  [[id, 英文, 中文, 难度排名, 估算CEFR, [词…]], ...]（按难度）
  pseudo.json     定级测试用的假词（不在任何词典里，但看着像英文）
  meta.json       版本、来源、授权、统计

来源与授权：
  ECDICT（MIT）https://github.com/skywind3000/ECDICT —— 词频 frq（COCA 系）/bnc、Collins 星级、牛津 3000、考试标签
  Tatoeba 中英句对（CC BY 2.0 FR，经 manythings.org/anki 打包）—— 每句保留原始句号做署名
  CMUdict（BSD）—— 发音打分用的标准音素
CEFR 是按词频排名的**估算**（A1≤800、A2≤2000、B1≤3500、B2≤6000、C1≤10000），界面上要标“估算”。

用法: .venv/bin/python content/build_content.py   （需要 opencc-python-reimplemented；源数据缓存在 .cache/content，缺了会自动下载）
"""
from __future__ import annotations

import csv
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

import opencc  # 繁体译文转简体（Tatoeba 里中文译文繁简混杂）

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "content"
OUT = ROOT / "content" / "pack"
SOURCES = {
    "ecdict.csv": "https://github.com/skywind3000/ECDICT/raw/master/ecdict.csv",
    "cmn-eng.zip": "https://www.manythings.org/anki/cmn-eng.zip",
}
MAX_WORDS = 12000
CEFR_CUTS = [(800, "A1"), (2000, "A2"), (3500, "B1"), (6000, "B2"), (10000, "C1")]
INFLECT = set("pdi3srt")  # ECDICT exchange 类型：过去式/过去分词/现在分词/三单/复数/比较级/最高级
# Tatoeba 里高频出现的人名：不在词频表里，但不该让句子变“难”
NAMES = {"tom", "mary", "john", "alice", "bob", "jack", "ken", "jim", "mike", "lucy", "emily", "bill", "jane", "paul", "susan", "boston", "london", "paris", "tokyo", "japan", "china", "america", "english", "french", "chinese", "japanese"}


NAME_RE = re.compile(r"(男子名|女子名|男名|女名|人名|姓氏|地名|昵称)")
# 缩写：拆成本体词（won't → will，can't → can，其余 n't 去掉；'m 're 's 'll 've 'd 只看前半）
CONTRACT = {"won't": "will", "can't": "can", "shan't": "shall", "ain't": "be"}


# 敏感话题：含这些词的例句不收；这些词留在词典里能查，但不排进每日新词（words.json 第 8 列 = 1）
SENSITIVE = set("""
suicide suicidal kill killed killing kills killer murder murdered murderer rape raped rapist sex sexual sexy porn pornography
drug drugs cocaine heroin marijuana overdose terrorist terrorism bomb bombing corpse corpses abortion naked nude prostitute
prostitution whore bitch slut fuck fucking shit bastard damn dick pussy genocide massacre torture tortured hang hanged hanging
gun guns shoot shooting shot stab stabbed bleed bleeding blood bloody cancer funeral grave coffin divorce racist nazi hitler
""".split())


def cefr(rank: int) -> str:
    for cut, band in CEFR_CUTS:
        if rank <= cut:
            return band
    return "C2"


def fetch() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        p = CACHE / name
        if not p.exists():
            print("下载", url, flush=True)
            urllib.request.urlretrieve(url, p)
    if not (CACHE / "cmn" / "cmn.txt").exists():
        zipfile.ZipFile(CACHE / "cmn-eng.zip").extractall(CACHE / "cmn")


def load_cmu() -> dict[str, str]:
    p = ROOT / "spikes" / "m0" / "web" / "samples" / "cmudict.min.json"
    return json.loads(p.read_text())


def clean_trans(t: str) -> str:
    lines = [ln.strip() for ln in t.replace("\\n", "\n").split("\n") if ln.strip() and not ln.strip().startswith("[")]
    return "；".join(lines[:3])[:120]


def build_words(cmu: dict[str, str]) -> tuple[list[list], dict[str, str]]:
    rows = []
    lemma: dict[str, str] = {}
    with open(CACHE / "ecdict.csv", encoding="utf-8") as f:
        for x in csv.DictReader(f):
            w = x["word"]
            if not re.fullmatch(r"[a-z][a-z'-]*[a-z]|[a-z]", w):
                continue  # 只要小写普通词：专名、缩写、词组另做
            frq, bnc = int(x["frq"] or 0), int(x["bnc"] or 0)
            rank = frq or bnc
            if not rank:
                continue
            ex = dict(kv.split(":", 1) for kv in x["exchange"].split("/") if ":" in kv)
            if "0" in ex and re.fullmatch(r"[a-z]+", ex["0"]):
                lemma.setdefault(w, ex["0"])
            core = (x["collins"] or "0") >= "3" or x["oxford"] == "1"
            if "0" in ex and set(ex.get("1", "")) <= INFLECT and not core:
                continue  # 纯变形（perceived）并到原形；running、thanks 这种常用独立词保留
            trans = clean_trans(x["translation"])
            if not trans or ((NAME_RE.search(trans) or trans.startswith("abbr.")) and not core):
                continue
            rows.append([w, rank, x["phonetic"], trans, x["tag"], cmu.get(w, "")])
    rows.sort(key=lambda r: r[1])
    seen, out = set(), []
    for w, rank, ph, tr, tag, cmu_ph in rows:
        if w in seen:
            continue
        seen.add(w)
        out.append([w, len(out) + 1, cefr(len(out) + 1), ph, tr, tag, cmu_ph, 1 if w in SENSITIVE else 0])  # 排名按去重后的顺序重排
        if len(out) >= MAX_WORDS:
            break
    return out, lemma


def tokens(en: str) -> list[str]:
    return [t.lower() for t in re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", en)]


def base_word(t: str, rank: dict[str, int], lemma: dict[str, str]) -> str:
    """句子里的词 → 词表里的词条：缩写拆开、变形还原成原形。"""
    if t in CONTRACT:
        t = CONTRACT[t]
    elif t.endswith("n't"):
        t = t[:-3]
    elif "'" in t:
        t = t.split("'")[0]
    if t == "i":
        return "i"
    if t in rank:
        return t
    return lemma.get(t, t)


def build_sentences(words: list[list], cmu: dict[str, str], lemma: dict[str, str]) -> list[list]:
    rank = {w[0]: w[1] for w in words}
    rank["i"] = 1  # 代词 I 在 ECDICT 里只有大写词条
    t2s = opencc.OpenCC("t2s")
    seen, out = set(), []
    with open(CACHE / "cmn" / "cmn.txt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            en, zh, attr = parts[0].strip(), parts[1].strip(), parts[2]
            m = re.search(r"#(\d+)", attr)
            if not m or en.lower() in seen:
                continue
            toks = tokens(en)
            if not (3 <= len(toks) <= 12):
                continue
            if any(t not in cmu for t in toks):
                continue  # 每个词都要能打分
            bases = [base_word(t, rank, lemma) for t in toks]
            if any(t in SENSITIVE or b in SENSITIVE or lemma.get(b, "") in SENSITIVE for t, b in zip(toks, bases)):
                continue
            # 难度取“这个形式”和“原形”里更常见的那个（coming 自身排 4115，但 come 是 A1）
            rs = [0 if t in NAMES else min(rank.get(b, 99999), rank.get(lemma.get(b, b), 99999)) for t, b in zip(toks, bases)]
            hard = max(rs)
            if hard > MAX_WORDS:
                continue
            seen.add(en.lower())
            # 最后一列是词表里的词条（原形），用来按“学到的词”挑例句
            out.append([int(m.group(1)), en, t2s.convert(zh), hard, cefr(max(hard, 1)), sorted(set(b for t, b in zip(toks, bases) if t not in NAMES) | set(lemma[b] for t, b in zip(toks, bases) if t not in NAMES and b in lemma))])
    out.sort(key=lambda s: (s[3], len(s[1])))
    return out


def build_pseudowords(words: list[list], cmu: dict[str, str], n: int = 120) -> list[str]:
    """定级用的假词（LexTALE 思路：混在真词里，勾了假词说明在“乱认”）。
    做法：常见词拆成“开头辅音+元音”和“剩余部分”，交叉拼接；只保留每个字母三连都在真词里常见、
    且不在 ECDICT 全部词条 / CMUdict 里的，看上去像真词但不是。"""
    import random
    allw = set()
    with open(CACHE / "ecdict.csv", encoding="utf-8") as f:
        for x in csv.DictReader(f):
            allw.add(x["word"].lower())
    allw |= set(cmu)
    src = [w[0] for w in words[800:6000] if re.fullmatch(r"[a-z]{5,9}", w[0])]
    tri: dict[str, int] = {}
    for w in src:
        for i in range(len(w) - 2):
            tri[w[i:i + 3]] = tri.get(w[i:i + 3], 0) + 1
    split = re.compile(r"^([^aeiouy]*[aeiouy]+)(.+)$")
    heads, tails = [], []
    for w in src:
        m = split.match(w)
        if m:
            heads.append(m.group(1))
            tails.append(m.group(2))
    common = {w[0] for w in words}

    def near_common(c: str) -> bool:
        """和常用词只差一个字母（替换/增/删）：像拼写错误，认识原词的人会误点“认识”"""
        letters = "abcdefghijklmnopqrstuvwxyz"
        for i in range(len(c) + 1):
            if i < len(c) and c[:i] + c[i + 1:] in common:
                return True
            for ch in letters:
                if i < len(c) and c[:i] + ch + c[i + 1:] in common:
                    return True
                if c[:i] + ch + c[i:] in common:
                    return True
        return False

    rnd = random.Random(20261011)
    out: list[str] = []
    for _ in range(200000):
        c = rnd.choice(heads) + rnd.choice(tails)
        if not (5 <= len(c) <= 9) or c in allw or c in out:
            continue
        if any(tri.get(c[i:i + 3], 0) < 3 for i in range(len(c) - 2)):
            continue
        # 去掉“真词 + 常见后缀”（看着像认识的词，测不出东西）
        if any(c.endswith(suf) and c[: -len(suf)] in allw for suf in ("s", "es", "ed", "ing", "er", "ly", "y", "ness", "ment", "ion")):
            continue
        if near_common(c):
            continue
        out.append(c)
        if len(out) >= n:
            break
    return out


def main() -> None:
    fetch()
    cmu = load_cmu()
    words, lemma = build_words(cmu)
    sents = build_sentences(words, cmu, lemma)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "words.json").write_text(json.dumps(words, ensure_ascii=False, separators=(",", ":")))
    (OUT / "sentences.json").write_text(json.dumps(sents, ensure_ascii=False, separators=(",", ":")))
    pseudo = build_pseudowords(words, cmu)
    (OUT / "pseudo.json").write_text(json.dumps(pseudo))
    by_band = {}
    for s in sents:
        by_band[s[4]] = by_band.get(s[4], 0) + 1
    meta = {
        "version": 1,
        "words": len(words),
        "sentences": len(sents),
        "sentences_by_cefr": by_band,
        "pseudowords": len(pseudo),
        "cefr_note": "CEFR 为按词频排名的估算",
        "sources": [
            {"name": "ECDICT", "url": "https://github.com/skywind3000/ECDICT", "license": "MIT"},
            {"name": "Tatoeba（经 manythings.org 打包的中英句对）", "url": "https://tatoeba.org", "license": "CC BY 2.0 FR", "attribution": "每条例句的 id 即 Tatoeba 英文原句编号：https://tatoeba.org/sentences/show/<id>"},
            {"name": "CMUdict", "url": "https://github.com/cmusphinx/cmudict", "license": "BSD-2-Clause"},
        ],
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(json.dumps({k: meta[k] for k in ("words", "sentences", "sentences_by_cefr")}, ensure_ascii=False))
    for f in ("words.json", "sentences.json"):
        print(f, round((OUT / f).stat().st_size / 1048576, 2), "MB")


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Fill leaves that are still identical to English. Never rewrite existing translations."""
from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "packages" / "shared" / "locales"
SKIP_NS = {"translation.json", "locales.json"}
LANGS = ["zh-CN", "ja", "ko", "hi", "es", "ar", "fr", "bn", "pt", "id", "ur"]

sys.path.insert(0, str(ROOT / "scripts"))
from importlib.machinery import SourceFileLoader

mt = SourceFileLoader("i18n_mt", str(ROOT / "scripts" / "i18n-mt-from-en.py")).load_module()


def walk_strings(en, cur, acc: list[str]) -> None:
    if isinstance(en, str):
        if isinstance(cur, str) and cur == en and not mt.should_skip_mt(en):
            acc.append(en)
        return
    if isinstance(en, list):
        cur = cur if isinstance(cur, list) else []
        for i, v in enumerate(en):
            walk_strings(v, cur[i] if i < len(cur) else v, acc)
        return
    if isinstance(en, dict):
        cur = cur if isinstance(cur, dict) else {}
        for k, v in en.items():
            walk_strings(v, cur.get(k, v), acc)


def fill_tree(en, cur, cache: dict[str, str], gloss: dict[str, str]):
    if isinstance(en, str):
        if not isinstance(cur, str) or cur != en:
            return cur if isinstance(cur, str) else en
        if en in gloss:
            return gloss[en]
        if mt.should_skip_mt(en):
            return en
        tr = cache.get(en)
        return tr if tr and tr != en else en
    if isinstance(en, list):
        cur = cur if isinstance(cur, list) else []
        return [fill_tree(v, cur[i] if i < len(cur) else v, cache, gloss) for i, v in enumerate(en)]
    if isinstance(en, dict):
        cur = cur if isinstance(cur, dict) else {}
        return {k: fill_tree(v, cur.get(k, v), cache, gloss) for k, v in en.items()}
    return cur


def main() -> int:
    workers = 6
    for lang in LANGS:
        pair = mt.LANG_MAP[lang]
        gloss = mt.GLOSSARY.get(lang, {})
        cache = mt.load_cache(lang)
        files = []
        todo: list[str] = []
        for f in sorted((LOCALES / "en").glob("*.json")):
            if f.name in SKIP_NS:
                continue
            en = json.loads(f.read_text(encoding="utf-8"))
            tgt_p = LOCALES / lang / f.name
            cur = json.loads(tgt_p.read_text(encoding="utf-8")) if tgt_p.exists() else {}
            files.append((f.name, en, cur))
            walk_strings(en, cur, todo)

        uniq = list(dict.fromkeys(todo))
        uniq = [s for s in uniq if s not in gloss and not (s in cache and cache[s] != s)]
        print(f"[{lang}] still-en leaves={len(todo)} unique_need_mt={len(uniq)}", flush=True)
        if uniq:
            done = 0
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = {ex.submit(mt.translate_one, pair, s): s for s in uniq}
                for fut in as_completed(futs):
                    s = futs[fut]
                    try:
                        out = fut.result()
                    except Exception:
                        out = s
                    if out and out != s:
                        cache[s] = out
                    done += 1
                    if done % 40 == 0:
                        mt.save_cache(lang, cache)
                        print(f"  [{lang}] {done}/{len(uniq)}", flush=True)
            mt.save_cache(lang, cache)

        changed = 0
        for name, en, cur in files:
            nxt = fill_tree(en, cur, cache, gloss)
            if nxt != cur:
                changed += 1
            (LOCALES / lang / name).write_text(
                json.dumps(nxt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        print(f"[{lang}] wrote files_touched={changed}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

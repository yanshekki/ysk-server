#!/usr/bin/env python3
"""Fill leaves that are still identical to English. Never rewrite existing translations."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "packages" / "shared" / "locales"
SKIP_NS = {"translation.json", "locales.json"}
LANGS = ["ja", "ko", "hi", "es", "ar", "fr", "bn", "pt", "id", "ur"]

# reuse skip rules from mt script
sys.path.insert(0, str(ROOT / "scripts"))
from importlib.machinery import SourceFileLoader

mt = SourceFileLoader("i18n_mt", str(ROOT / "scripts" / "i18n-mt-from-en.py")).load_module()


def walk_pairs(en, cur, path=""):
    if isinstance(en, str):
        yield path, en, cur if isinstance(cur, str) else en
        return
    if isinstance(en, dict):
        cur = cur if isinstance(cur, dict) else {}
        for k, v in en.items():
            yield from walk_pairs(v, cur.get(k), f"{path}.{k}" if path else k)


def set_path(obj, path, value):
    parts = path.split(".")
    cur = obj
    for p in parts[:-1]:
        if p not in cur or not isinstance(cur[p], dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value


def main() -> int:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    workers = 6
    for lang in LANGS:
        pair = mt.LANG_MAP[lang]
        gloss = mt.GLOSSARY.get(lang, {})
        cache = mt.load_cache(lang)
        todo: list[tuple[str, str, str]] = []  # file, path, en
        files = []
        for f in sorted((LOCALES / "en").glob("*.json")):
            if f.name in SKIP_NS:
                continue
            en = json.loads(f.read_text(encoding="utf-8"))
            tgt_p = LOCALES / lang / f.name
            cur = json.loads(tgt_p.read_text(encoding="utf-8")) if tgt_p.exists() else {}
            files.append((f.name, en, cur))
            for path, en_s, cur_s in walk_pairs(en, cur):
                if not isinstance(en_s, str):
                    continue
                if cur_s != en_s:
                    continue
                if mt.should_skip_mt(en_s):
                    continue
                if en_s in gloss:
                    continue
                if en_s in cache and cache[en_s] != en_s:
                    continue
                todo.append((f.name, path, en_s))

        uniq = list(dict.fromkeys(s for _, _, s in todo))
        print(f"[{lang}] still-en leaves={len(todo)} unique={len(uniq)}", flush=True)
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
            for path, en_s, cur_s in walk_pairs(en, cur):
                if cur_s != en_s:
                    continue
                if en_s in gloss:
                    set_path(cur, path, gloss[en_s])
                    changed += 1
                    continue
                if en_s in cache and cache[en_s] != en_s:
                    set_path(cur, path, cache[en_s])
                    changed += 1
            (LOCALES / lang / name).write_text(
                json.dumps(cur, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        print(f"[{lang}] wrote changed={changed}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

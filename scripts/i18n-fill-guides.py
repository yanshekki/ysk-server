#!/usr/bin/env python3
"""Fill About-tab guides for locales that only fall back to English."""
from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "apps" / "web" / "src" / "shared" / "guides" / "data"
LANGS = ["ja", "ko", "hi", "es", "ar", "fr", "bn", "pt", "id", "ur"]

sys.path.insert(0, str(ROOT / "scripts"))
from importlib.machinery import SourceFileLoader

mt = SourceFileLoader("i18n_mt", str(ROOT / "scripts" / "i18n-mt-from-en.py")).load_module()

SKIP_KEYS = {"id", "to"}


def collect(en, acc: list[str], key: str = "") -> None:
    if key in SKIP_KEYS:
        return
    if isinstance(en, str):
        if key == "cliHints" or en.startswith("ysk-server") or en.startswith("/"):
            return
        if not mt.should_skip_mt(en):
            acc.append(en)
        return
    if isinstance(en, list):
        for v in en:
            collect(v, acc, key)
        return
    if isinstance(en, dict):
        for k, v in en.items():
            collect(v, acc, k)


def apply_tree(en, cache: dict[str, str], key: str = ""):
    if key in SKIP_KEYS:
        return en
    if isinstance(en, str):
        if key == "cliHints" or en.startswith("ysk-server") or en.startswith("/"):
            return en
        if mt.should_skip_mt(en):
            return en
        tr = cache.get(en)
        return tr if tr and tr != en else en
    if isinstance(en, list):
        return [apply_tree(v, cache, key) for v in en]
    if isinstance(en, dict):
        return {k: apply_tree(v, cache, k) for k, v in en.items()}
    return en


def main() -> int:
    en = json.loads((DATA / "en.json").read_text(encoding="utf-8"))
    workers = 6
    for lang in LANGS:
        pair = mt.LANG_MAP[lang]
        cache = mt.load_cache(f"guides-{lang}")
        todo: list[str] = []
        collect(en, todo)
        uniq = list(dict.fromkeys(todo))
        need = [s for s in uniq if not (s in cache and cache[s] != s)]
        print(f"[guides {lang}] unique={len(uniq)} need_mt={len(need)}", flush=True)
        if need:
            done = 0
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = {ex.submit(mt.translate_one, pair, s): s for s in need}
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
                        mt.save_cache(f"guides-{lang}", cache)
                        print(f"  [guides {lang}] {done}/{len(need)}", flush=True)
            mt.save_cache(f"guides-{lang}", cache)
        out = apply_tree(en, cache)
        (DATA / f"{lang}.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"[guides {lang}] wrote", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

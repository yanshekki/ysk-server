#!/usr/bin/env python3
"""Deep-merge en namespace keys into every locale (keep existing translations)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path("packages/shared/locales")
EN = ROOT / "en"


def deep_merge(dst, src):
    """Fill missing keys from src into dst. Returns (merged, added_count)."""
    added = 0
    if not isinstance(src, dict):
        return src, 0
    out = dict(dst) if isinstance(dst, dict) else {}
    for k, v in src.items():
        if k not in out:
            out[k] = v
            added += 1 if not isinstance(v, dict) else _count_leaves(v)
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k], a = deep_merge(out[k], v)
            added += a
        elif isinstance(v, dict) and not isinstance(out.get(k), dict):
            out[k] = v
            added += _count_leaves(v)
    return out, added


def _count_leaves(o):
    if isinstance(o, dict):
        return sum(_count_leaves(v) for v in o.values())
    return 1


def prune_extra(dst, src):
    """Remove keys not in en."""
    if not isinstance(dst, dict) or not isinstance(src, dict):
        return dst
    out = {}
    for k, v in dst.items():
        if k not in src:
            continue
        if isinstance(v, dict) and isinstance(src[k], dict):
            out[k] = prune_extra(v, src[k])
        else:
            out[k] = v
    return out


def main():
    only = sys.argv[1:]  # optional namespace names without .json
    en_files = sorted(EN.glob("*.json"))
    if only:
        en_files = [EN / f"{n}.json" for n in only if (EN / f"{n}.json").exists()]
    langs = sorted(
        p.name
        for p in ROOT.iterdir()
        if p.is_dir() and p.name != "en" and (p / "common.json").exists() or p.is_dir() and p.name not in ("en",)
    )
    langs = sorted(
        p.name for p in ROOT.iterdir() if p.is_dir() and p.name != "en"
    )
    total_added = 0
    for ef in en_files:
        if ef.name == "translation.json":
            continue
        en = json.loads(ef.read_text(encoding="utf-8"))
        for lang in langs:
            path = ROOT / lang / ef.name
            cur = {}
            if path.exists():
                try:
                    cur = json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    cur = {}
            merged, added = deep_merge(cur, en)
            merged = prune_extra(merged, en)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(merged, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            if added:
                print(f"{lang}/{ef.name}: +{added}")
                total_added += added
    print(f"TOTAL_ADDED={total_added}")


if __name__ == "__main__":
    main()

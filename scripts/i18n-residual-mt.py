#!/usr/bin/env python3
"""Translate residual same-as-en leaves for selected namespaces (or all)."""
from __future__ import annotations

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from deep_translator import GoogleTranslator

ROOT = Path("packages/shared/locales")
EN = ROOT / "en"
SKIP_RE = re.compile(
    r"^(https?://|/[a-z]|YSK_|{{|}}|[A-Z0-9_.-]{2,}$|\$[a-zA-Z]|v?\d+\.\d+)",
    re.I,
)
# Keep pure code-like / brand short tokens
BRAND = re.compile(r"^(GitHub|Linktree|Chrome|Chromium|WebTorrent|EVM|NEAR|ADA|SSH|VPN|VNC|DNS|SSL|TLS|HTTP|HTTPS|API|CLI|JSON|YAML|XML|PDF|CDN|FTP|SFTP|SMTP|IMAP|BT|IP|URL|ID|OK)$")

LANG_GOOGLE = {
    "ja": "ja",
    "ko": "ko",
    "es": "es",
    "fr": "fr",
    "pt": "pt",
    "id": "id",
    "hi": "hi",
    "bn": "bn",
    "ar": "ar",
    "ur": "ur",
    "zh-CN": "zh-CN",
    "zh-HK": "zh-TW",
}


def leaves(o, p=""):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from leaves(v, f"{p}.{k}" if p else k)
    elif isinstance(o, str):
        yield p, o


def set_path(o, path, val):
    parts = path.split(".")
    cur = o
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
    cur[parts[-1]] = val


def should_skip(s: str) -> bool:
    s = s.strip()
    if not s or len(s) < 2:
        return True
    if "{{" in s and "}}" in s and len(s) < 12:
        return True
    if BRAND.match(s):
        return True
    if SKIP_RE.match(s) and " " not in s:
        return True
    # mostly non-letters
    letters = sum(c.isalpha() for c in s)
    if letters < 2:
        return True
    return False


def protect(s: str):
    holders = []

    def repl(m):
        holders.append(m.group(0))
        return f"⟦{len(holders)-1}⟧"

    t = re.sub(r"\{\{[^}]+\}\}", repl, s)
    t = re.sub(r"`[^`]+`", repl, t)
    return t, holders


def restore(s: str, holders):
    for i, h in enumerate(holders):
        s = s.replace(f"⟦{i}⟧", h)
        s = s.replace(f"[[{i}]]", h)
    return s


def translate_one(lang: str, text: str) -> str:
    g = LANG_GOOGLE[lang]
    protected, holders = protect(text)
    for attempt in range(3):
        try:
            time.sleep(0.06)
            out = GoogleTranslator(source="en", target=g).translate(protected)
            if not out or out.strip() == protected.strip():
                return text
            return restore(out, holders)
        except Exception:
            time.sleep(0.4 * (attempt + 1))
    return text


def process_lang(lang: str, ns_filter: set[str] | None):
    en_dir = EN
    lang_dir = ROOT / lang
    cache_path = Path(".cache/i18n-mt") / f"{lang}-residual.json"
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache = {}
    if cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            cache = {}

    todo: list[tuple[str, str, str]] = []  # ns, path, en_text
    for ef in sorted(en_dir.glob("*.json")):
        if ef.name == "translation.json":
            continue
        if ns_filter and ef.stem not in ns_filter:
            continue
        en = json.loads(ef.read_text(encoding="utf-8"))
        lp = lang_dir / ef.name
        if not lp.exists():
            continue
        loc = json.loads(lp.read_text(encoding="utf-8"))
        en_map = dict(leaves(en))
        loc_map = dict(leaves(loc))
        for path, en_s in en_map.items():
            if not isinstance(en_s, str):
                continue
            cur = loc_map.get(path)
            if cur is None or cur == en_s:
                if should_skip(en_s):
                    continue
                todo.append((ef.stem, path, en_s))

    # unique texts
    uniq = sorted({t for _, _, t in todo})
    print(f"[{lang}] residual unique={len(uniq)} leaves={len(todo)}")

    def one(s: str):
        if s in cache and cache[s] != s:
            return s, cache[s]
        tr = translate_one(lang, s)
        return s, tr

    with ThreadPoolExecutor(max_workers=5) as ex:
        futs = [ex.submit(one, s) for s in uniq]
        done = 0
        for fut in as_completed(futs):
            s, tr = fut.result()
            if tr and tr != s:
                cache[s] = tr
            done += 1
            if done % 40 == 0:
                print(f"  [{lang}] {done}/{len(uniq)}")
                cache_path.write_text(
                    json.dumps(cache, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )

    cache_path.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # apply
    changed_files = 0
    for ef in sorted(en_dir.glob("*.json")):
        if ef.name == "translation.json":
            continue
        if ns_filter and ef.stem not in ns_filter:
            continue
        en = json.loads(ef.read_text(encoding="utf-8"))
        lp = lang_dir / ef.name
        if not lp.exists():
            continue
        loc = json.loads(lp.read_text(encoding="utf-8"))
        dirty = False
        for path, en_s in leaves(en):
            if not isinstance(en_s, str):
                continue
            # walk loc value
            parts = path.split(".")
            cur = loc
            ok = True
            for p in parts[:-1]:
                if not isinstance(cur, dict) or p not in cur:
                    ok = False
                    break
                cur = cur[p]
            if not ok or not isinstance(cur, dict):
                continue
            last = parts[-1]
            val = cur.get(last)
            if val == en_s or val is None:
                if en_s in cache and cache[en_s] != en_s:
                    cur[last] = cache[en_s]
                    dirty = True
                elif val is None:
                    cur[last] = en_s
                    dirty = True
        if dirty:
            lp.write_text(
                json.dumps(loc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            changed_files += 1
    print(f"[{lang}] wrote {changed_files} files")


def main():
    ns = set(sys.argv[1:]) if len(sys.argv) > 1 else None
    # if first args look like langs? use --ns=
    ns_filter = None
    langs = list(LANG_GOOGLE.keys())
    args = sys.argv[1:]
    if args and args[0] == "--ns":
        ns_filter = set(args[1].split(","))
        args = args[2:]
    if args:
        langs = [a for a in args if a in LANG_GOOGLE]
    for lang in langs:
        process_lang(lang, ns_filter)


if __name__ == "__main__":
    main()

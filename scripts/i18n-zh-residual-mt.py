#!/usr/bin/env python3
"""Fill residual same-as-en strings for zh-CN / zh-HK via Google Translate."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

from deep_translator import GoogleTranslator

ROOT = Path("packages/shared/locales")
en_dir = ROOT / "en"
SKIP = re.compile(
    r"^(YSK(\sServer)?|ysk-server|OK|ID|IP|URL|API|JSON|XML|CSV|HTML|CSS|JS|UI|SSH|FTP|CDN|VPN|VNC|SQL|PHP|TLS|SSL|HTTP|HTTPS|CLI|FPM|DNSSEC|DKIM|DMARC|Linux|Ubuntu|Debian|Nginx|Apache|MySQL|MariaDB|PostgreSQL|Redis|Docker|systemd|Cron|Rust|Java|Kotlin|Node\.js|Python( 3)?|fail2ban|Postfix|Dovecot|OpenDKIM|PowerDNS|Cloudflare|Fastly|Memcached|OPcache)$",
    re.I,
)


def walk(o, p=()):
    if isinstance(o, str):
        yield p, o
    elif isinstance(o, dict):
        for k, v in o.items():
            yield from walk(v, p + (k,))


def set_at(root, parts, value):
    cur = root
    for part in parts[:-1]:
        cur = cur[part]
    cur[parts[-1]] = value


def load_ns(lang, name):
    p = ROOT / lang / name
    return json.loads(p.read_text(encoding="utf-8"))


def should_skip(s: str) -> bool:
    t = s.strip()
    if not t or len(t) <= 1:
        return True
    if SKIP.match(t):
        return True
    if re.fullmatch(r"[\d\s\.\,\:\;\-\/\+\=\(\)\[\]\{\}\|\%\#\@\!\?\'\"\`\_]+", t):
        return True
    if t.startswith("http://") or t.startswith("https://") or t.startswith("/"):
        return True
    return False


def main() -> None:
    cache_cn: dict[str, str] = {}
    cache_hk: dict[str, str] = {}
    tr_cn = GoogleTranslator(source="en", target="zh-CN")
    tr_tw = GoogleTranslator(source="en", target="zh-TW")
    updated = {"zh-CN": 0, "zh-HK": 0}

    for f in sorted(en_dir.glob("*.json")):
        if f.name == "translation.json":
            continue
        en = load_ns("en", f.name)
        cn = load_ns("zh-CN", f.name)
        hk = load_ns("zh-HK", f.name)
        dirty_cn = dirty_hk = False
        for parts, en_s in walk(en):
            if should_skip(en_s):
                continue
            # zh-CN
            cur = cn
            ok = True
            for part in parts:
                if not isinstance(cur, dict) or part not in cur:
                    ok = False
                    break
                cur = cur[part]
            if ok and cur == en_s:
                if en_s not in cache_cn:
                    try:
                        time.sleep(0.05)
                        cache_cn[en_s] = tr_cn.translate(en_s[:4500]) or en_s
                    except Exception:
                        cache_cn[en_s] = en_s
                if cache_cn[en_s] != en_s:
                    set_at(cn, parts, cache_cn[en_s])
                    dirty_cn = True
                    updated["zh-CN"] += 1
            # zh-HK via zh-TW target
            cur = hk
            ok = True
            for part in parts:
                if not isinstance(cur, dict) or part not in cur:
                    ok = False
                    break
                cur = cur[part]
            if ok and cur == en_s:
                if en_s not in cache_hk:
                    try:
                        time.sleep(0.05)
                        cache_hk[en_s] = tr_tw.translate(en_s[:4500]) or en_s
                    except Exception:
                        cache_hk[en_s] = en_s
                if cache_hk[en_s] != en_s:
                    set_at(hk, parts, cache_hk[en_s])
                    dirty_hk = True
                    updated["zh-HK"] += 1
        if dirty_cn:
            (ROOT / "zh-CN" / f.name).write_text(
                json.dumps(cn, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        if dirty_hk:
            (ROOT / "zh-HK" / f.name).write_text(
                json.dumps(hk, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        print(f.name, "cn+", updated["zh-CN"], "hk+", updated["zh-HK"], flush=True)
    print("DONE", updated)


if __name__ == "__main__":
    main()

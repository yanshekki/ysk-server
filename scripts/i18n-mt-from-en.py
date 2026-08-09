#!/usr/bin/env python3
"""
Machine-translate packages/shared/locales/* from English with key parity.

Preserves {{placeholders}}, %s-style tokens, and brand/code-like strings.
Uses deep_translator Google backend + disk cache under .cache/i18n-mt/

Usage:
  python3 scripts/i18n-mt-from-en.py                 # all Tier-2 + ja/ko
  python3 scripts/i18n-mt-from-en.py --langs ja,ko   # only some
  python3 scripts/i18n-mt-from-en.py --limit 200     # smoke
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "packages" / "shared" / "locales"
CACHE_DIR = ROOT / ".cache" / "i18n-mt"
SKIP_NS = {"translation.json"}

# MyMemory codes (more reliable free tier than Google for bulk)
LANG_MAP = {
    "ja": ("en-GB", "ja-JP"),
    "ko": ("en-GB", "ko-KR"),
    "hi": ("en-GB", "hi-IN"),
    "es": ("en-GB", "es-ES"),
    "ar": ("en-GB", "ar-SA"),
    "fr": ("en-GB", "fr-FR"),
    "bn": ("en-GB", "bn-IN"),
    "pt": ("en-GB", "pt-PT"),
    "id": ("en-GB", "id-ID"),
    "ur": ("en-GB", "ur-PK"),
}

# High-frequency UI glossary (overrides MT for short labels)
GLOSSARY: dict[str, dict[str, str]] = {
    "ja": {
        "Cancel": "キャンセル",
        "Save": "保存",
        "Delete": "削除",
        "Edit": "編集",
        "Create": "作成",
        "Refresh": "更新",
        "Search": "検索",
        "Language": "言語",
        "Logout": "ログアウト",
        "Login": "ログイン",
        "Password": "パスワード",
        "Username": "ユーザー名",
        "Status": "状態",
        "Settings": "設定",
        "About": "説明",
        "Yes": "はい",
        "No": "いいえ",
        "Close": "閉じる",
        "Back": "戻る",
        "Next": "次へ",
        "Previous": "前へ",
        "Apply": "適用",
        "Install": "インストール",
        "Uninstall": "アンインストール",
        "Enable": "有効",
        "Disable": "無効",
        "Enabled": "有効",
        "Disabled": "無効",
        "Loading…": "読み込み中…",
        "Loading...": "読み込み中…",
        "Error": "エラー",
        "Success": "成功",
        "Warning": "警告",
        "On": "オン",
        "Off": "オフ",
        "All": "すべて",
        "None": "なし",
        "Unknown": "不明",
        "User": "ユーザー",
        "Users": "ユーザー",
        "System": "システム",
        "Network": "ネットワーク",
        "Security": "セキュリティ",
        "Dashboard": "ダッシュボード",
        "Projects": "プロジェクト",
        "Files": "ファイル",
        "Email": "メール",
        "Logs": "ログ",
        "Updates": "更新",
        "Terminal": "ターミナル",
        "Cron": "Cron",
        "Not installed": "未インストール",
        "Ready": "準備完了",
    },
    "ko": {
        "Cancel": "취소",
        "Save": "저장",
        "Delete": "삭제",
        "Edit": "편집",
        "Create": "만들기",
        "Refresh": "새로고침",
        "Search": "검색",
        "Language": "언어",
        "Logout": "로그아웃",
        "Login": "로그인",
        "Password": "비밀번호",
        "Username": "사용자 이름",
        "Status": "상태",
        "Settings": "설정",
        "About": "설명",
        "Yes": "예",
        "No": "아니요",
        "Close": "닫기",
        "Back": "뒤로",
        "Next": "다음",
        "Previous": "이전",
        "Apply": "적용",
        "Install": "설치",
        "Uninstall": "제거",
        "Enable": "사용",
        "Disable": "사용 안 함",
        "Enabled": "사용",
        "Disabled": "사용 안 함",
        "Loading…": "로딩 중…",
        "Loading...": "로딩 중…",
        "Error": "오류",
        "Success": "성공",
        "Warning": "경고",
        "On": "켜짐",
        "Off": "꺼짐",
        "All": "전체",
        "None": "없음",
        "Unknown": "알 수 없음",
        "User": "사용자",
        "Users": "사용자",
        "System": "시스템",
        "Network": "네트워크",
        "Security": "보안",
        "Dashboard": "대시보드",
        "Projects": "프로젝트",
        "Files": "파일",
        "Email": "이메일",
        "Logs": "로그",
        "Updates": "업데이트",
        "Terminal": "터미널",
        "Cron": "Cron",
        "Not installed": "미설치",
        "Ready": "준비됨",
    },
}

PLACEHOLDER_RE = re.compile(r"(\{\{[^}]+\}\}|\{[a-zA-Z0-9_]+\}|%[sdif]|\$\{[^}]+\})")
CODEISH_RE = re.compile(
    r"^(YSK Server|ysk-server|vsftpd|nginx|redis|MySQL|MariaDB|PostgreSQL|pm2|"
    r"systemd|SSH|SFTP|FTPS|SSL|TLS|DNS|CDN|API|HTTP|HTTPS|JSON|CLI|"
    r"[A-Z0-9_]{2,}|[a-z]+(?:\.[a-z0-9_]+)+|/[a-z0-9_./-]+)$"
)


def should_skip_mt(s: str) -> bool:
    t = s.strip()
    if not t:
        return True
    if len(t) <= 1:
        return True
    if t in {"—", "–", "-", "…", "...", "·", "•", "→", "←", "✓", "✕", "<?", "／；。"}:
        return True
    # punctuation-only / symbols
    if re.fullmatch(r"[\W_]+", t, flags=re.UNICODE):
        return True
    if re.fullmatch(r"[\d\s./:+-]+", t):
        return True
    if CODEISH_RE.match(t):
        return True
    # pure code tokens / paths
    if t.startswith("http://") or t.startswith("https://") or t.startswith("`"):
        return True
    return False


def protect(s: str) -> tuple[str, list[str]]:
    holders: list[str] = []

    def repl(m: re.Match[str]) -> str:
        holders.append(m.group(0))
        return f"⟦{len(holders) - 1}⟧"

    return PLACEHOLDER_RE.sub(repl, s), holders


def restore(s: str, holders: list[str]) -> str:
    out = s
    for i, h in enumerate(holders):
        # MT may break brackets
        for token in (f"⟦{i}⟧", f"[[{i}]]", f"[{i}]", f"{{{i}}}"):
            if token in out:
                out = out.replace(token, h)
                break
    return out


def load_cache(lang: str) -> dict[str, str]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = CACHE_DIR / f"{lang}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {}


def save_cache(lang: str, cache: dict[str, str]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = CACHE_DIR / f"{lang}.json"
    p.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def collect_en_strings() -> list[str]:
    en_dir = LOCALES / "en"
    uniq: set[str] = set()

    def walk(o):
        if isinstance(o, str):
            uniq.add(o)
        elif isinstance(o, dict):
            for v in o.values():
                walk(v)

    for f in sorted(en_dir.glob("*.json")):
        if f.name in SKIP_NS:
            continue
        walk(json.loads(f.read_text(encoding="utf-8")))
    return sorted(uniq, key=lambda s: (len(s), s))


def map_tree(obj, cache: dict[str, str], gloss: dict[str, str]):
    if isinstance(obj, str):
        if obj in gloss:
            return gloss[obj]
        if should_skip_mt(obj):
            return obj
        return cache.get(obj, obj)
    if isinstance(obj, dict):
        return {k: map_tree(v, cache, gloss) for k, v in obj.items()}
    return obj


def translate_one(pair: tuple[str, str], s: str) -> str:
    from deep_translator import MyMemoryTranslator

    protected, holders = protect(s)
    if not protected.strip():
        return s
    # MyMemory free tier is sensitive — pace hard
    time.sleep(0.25)
    src, dst = pair
    for attempt in range(1, 4):
        try:
            translator = MyMemoryTranslator(source=src, target=dst)
            out = translator.translate(protected[:480])  # API length limit
            if out is None or not str(out).strip():
                raise RuntimeError("empty translation")
            return restore(str(out), holders)
        except Exception:
            time.sleep(min(3 * attempt, 15))
    return s


def purge_false_english(cache: dict[str, str]) -> int:
    """Drop cache entries that are still English (failed/rate-limited) so we retry."""
    drop = [k for k, v in cache.items() if k == v and not should_skip_mt(k)]
    for k in drop:
        del cache[k]
    return len(drop)


def translate_missing(
    lang: str,
    strings: list[str],
    cache: dict[str, str],
    limit: int | None,
    workers: int = 4,
) -> dict[str, str]:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    pair = LANG_MAP[lang]
    gloss = GLOSSARY.get(lang, {})

    # Retry previously stuck English leftovers
    n_purge = purge_false_english(cache)
    if n_purge:
        print(f"[{lang}] purged false-English cache entries: {n_purge}", flush=True)

    todo: list[str] = []
    for s in strings:
        if limit is not None and len(todo) >= limit:
            break
        if s in gloss:
            cache[s] = gloss[s]
            continue
        if should_skip_mt(s):
            cache[s] = s
            continue
        if s in cache and str(cache[s]).strip() and cache[s] != s:
            continue
        todo.append(s)

    print(f"[{lang}] need translate: {len(todo)} (cache={len(cache)}) workers={workers}", flush=True)
    ok = 0
    fail = 0
    same = 0
    done_n = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(translate_one, pair, s): s for s in todo}
        for fut in as_completed(futs):
            s = futs[fut]
            done_n += 1
            try:
                out = fut.result()
            except Exception:
                out = s
            if not out or not str(out).strip():
                out = s
                fail += 1
            elif out == s:
                same += 1
            else:
                ok += 1
            cache[s] = out
            if done_n % 30 == 0:
                save_cache(lang, cache)
                print(
                    f"  [{lang}] {done_n}/{len(todo)} ok={ok} same={same} fail={fail}",
                    flush=True,
                )
    save_cache(lang, cache)
    print(
        f"[{lang}] done ok={ok} same={same} fail={fail} total={len(todo)}",
        flush=True,
    )
    return cache


def apply_lang(lang: str, cache: dict[str, str]) -> None:
    en_dir = LOCALES / "en"
    out_dir = LOCALES / lang
    out_dir.mkdir(parents=True, exist_ok=True)
    gloss = GLOSSARY.get(lang, {})
    for f in sorted(en_dir.glob("*.json")):
        if f.name in SKIP_NS:
            continue
        data = json.loads(f.read_text(encoding="utf-8"))
        mapped = map_tree(data, cache, gloss)
        (out_dir / f.name).write_text(
            json.dumps(mapped, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(f"[{lang}] wrote namespaces → {out_dir}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--langs", default=",".join(LANG_MAP.keys()))
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--apply-only", action="store_true")
    args = ap.parse_args()
    langs = [x.strip() for x in args.langs.split(",") if x.strip()]
    for lang in langs:
        if lang not in LANG_MAP:
            print("unknown lang", lang, file=sys.stderr)
            return 2

    strings = collect_en_strings()
    print("unique en strings:", len(strings), flush=True)

    for lang in langs:
        cache = load_cache(lang)
        if not args.apply_only:
            cache = translate_missing(
                lang, strings, cache, args.limit, workers=max(1, args.workers)
            )
        apply_lang(lang, cache)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

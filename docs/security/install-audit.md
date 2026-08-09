# install.sh security & completeness audit (2026-08-09)

Language: English | [中文](./install-audit-ZH.md)

## High findings and status

| ID | Finding | Status |
|----|---------|--------|
| I-01 | Remote `curl` of install libs without pin | **Mitigated** — refuse non-HTTPS `YSK_INSTALL_RAW`; document commit-SHA pin |
| I-02 | Setup failure swallowed | **Fixed** — hard fail if `config.json` missing |
| I-03 | No install-time TLS / HTTP default | **Fixed** — `ssl bootstrap` + HTTPS-only config |
| I-04 | `listenHost` 127.0.0.1 blocks IP login | **Fixed** — setup `--host 0.0.0.0` with bootstrap TLS |
| I-05 | Key permissions | **Fixed** — `ssl/panel` 700, key 600 |
| I-06 | `npm @latest` unpinned | **Mitigated** — `YSK_NPM_VERSION` + log resolved package |

## Medium

| ID | Status |
|----|--------|
| I-08 | **Fixed** — quote `cli_js` in sudo wrapper |
| I-11 | **Fixed** — `print_next` no longer re-runs setup as step 1 |
| I-12 | **Fixed** — default locale `zh-HK` |

## Residual

- Global `npm -g` as root remains (I-07) — prefer future dedicated user
- Optional checksum file for remote install assets not yet shipped
- Existing HTTP installs are **not** auto-migrated; run `ysk-server ssl bootstrap --force`

## Bootstrap TLS operator path

```bash
ysk-server ssl bootstrap --data-dir /var/lib/ysk-server
ysk-server serve --data-dir /var/lib/ysk-server --port 9287
# https://<IP>:9287 — accept self-signed warning
```

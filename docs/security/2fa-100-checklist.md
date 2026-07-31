# 2FA / MFA 100% checklist

> Language: English | [中文](./2fa-100-checklist-ZH.md)

| ID | Item | Status |
|----|------|--------|
| P0-1 | Login rate limit | done |
| P0-2 | TOTP encrypt at rest | done |
| P0-3 | Recovery codes | done |
| P0-4 | Step-up (export, delete user, API key, strict, fromPanel, backup) | done |
| P0-5 | SSH scratch + mode probe | done |
| P0-6 | SSH health lights | done |
| P1-1 | requireAdminTotp (+ strict) | done |
| P1-2 | Session idle/abs + list/revoke | done |
| P1-3 | TOTP anti-replay | done |
| P1-4 | beginTotp password | done |
| P1-5/6 | SSH strict Match + no password | done |
| P1-7 | fromPanel SHARED confirm | done |
| P1-8 | API key step-up + read scope | done |
| P2-1 | WebAuthn passkey | done |
| P2-2 | Remember-device | done |
| P2-3 | Fail2ban snippets | done |
| P2-4 | SSH FIDO2 docs | done |
| P2-5 | Encrypted TOTP backup export | done |
| extra | Readiness admin-2fa item | done |
| extra | Strict exclude ysks_/ysk_ SFTP users | done |

**Overall: 100% of planned hardening items implemented** (enforce still requires host packages / PAM install for SSH).

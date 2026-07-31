# Panel 2FA vs SSH 2FA

> Language: English | [中文](./2fa-panel-vs-ssh-ZH.md)

## Short answer

| Share? | What |
|--------|------|
| **Yes** | TOTP crypto (`totp.ts`), enrollment UX pattern, audit style |
| **No (default)** | One secret / one switch for both Web login and SSH |
| **Optional advanced** | Explicit “sync panel secret → this Linux user” with warnings |

Panel 2FA protects the **control plane**. SSH 2FA protects **OS login**. Different identity, different verifier, different lockout risk.

## Current state (YSK)

- **Panel**: `AuthService` + `/api/v1/auth/totp/*` — secret on panel user row; verified in Node on login.
- **SSH 2FA** (productized): `packages/core/src/security/ssh-2fa/*`
  - Registry: `dataDir/secrets/ssh/ssh-2fa.json` (secret AES-GCM, same master key as identity vault)
  - Enroll → confirm code → install `~/.google_authenticator` (dry-run default / `--execute`)
  - PAM snippet with **nullok** + sshd hints under secrets dir and API
  - UI: **安全 → SSH → 登入 2FA**
  - CLI: `ysk-server ssh-2fa list|enroll|confirm|install|pam|retire`
  - Optional advanced: `fromPanel` / `--from-panel` copies operator TOTP secret (admin only; shared risk)

### CLI examples

```bash
ysk-server ssh-2fa enroll --project UUID --json          # independent secret
ysk-server ssh-2fa enroll --user deploy --from-panel --json   # advanced share
ysk-server ssh-2fa confirm --id UUID --code 123456 --json
ysk-server ssh-2fa install --id UUID                     # dry-run
ysk-server ssh-2fa install --id UUID --execute           # write home file
ysk-server ssh-2fa pam --json
```

## Recommended product shape

1. Keep Panel 2FA on **安全 → 帳戶安全**.
2. If/when SSH 2FA ships: **安全 → SSH → 登入第二因素**, bound to **Linux user / project**, independent secret by default.
3. Honest pipeline: enrolled → file written → PAM active → sshd requires 2FA (each step separate).
4. Anti-lockout: never enable keyboard-interactive-only without a recovery path; coordinate with project `internal-sftp` Match snippets.

## Related

- Panel TOTP: `packages/core/src/security/totp.ts`, `packages/core/src/services/auth.ts`
- SSH keys (orthogonal): identity vault = outbound private keys; login public keys = authorized_keys — not 2FA.

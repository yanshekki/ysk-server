# SSH with FIDO2 / hardware keys

Hardware-backed SSH keys (FIDO2) complement panel TOTP / SSH TOTP. They are **orthogonal** to YSK’s identity vault (software keys) and SSH 2FA (PAM TOTP).

## Generate (client)

```bash
# OpenSSH 8.2+
ssh-keygen -t ecdsa-sk -f ~/.ssh/id_ecdsa_sk -C "ysk-fido"
# or
ssh-keygen -t ed25519-sk -f ~/.ssh/id_ed25519_sk -C "ysk-fido"
```

Touch the security key when prompted. Public key ends with `sk-ecdsa-sha2-nistp256@openssh.com` or `sk-ssh-ed25519@openssh.com`.

## Server

1. OpenSSH ≥ 8.2 with FIDO support.
2. Install public key into target user’s `authorized_keys` (YSK: **安全 → SSH → 登入授權** or project home).
3. Prefer `PubkeyAuthentication yes` and **disable password**.
4. Optional: combine with PAM TOTP only if you need second factor *after* key (strict Match). Hardware key alone is already phishing-resistant.

## YSK panel

- Store **public** key via login authorized_keys flow (not private sk material).
- Do **not** import `*_sk` private keys into identity vault for multi-host use without understanding resident-key UX.
- For control-plane outbound (peer scp), software ed25519 vault keys remain the supported path; FIDO is primarily for **human interactive SSH**.

## Related

- [2fa-panel-vs-ssh.md](./2fa-panel-vs-ssh.md)
- [ssh-identities.md](./ssh-identities.md)

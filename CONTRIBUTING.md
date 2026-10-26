# Contributing to YSK Server

> Language: English | [中文](./CONTRIBUTING-ZH.md)

YSK Server is a **single-host** Linux control plane. You install it on a machine you operate. Industry products (salon, trading, maps, …) do not belong in this repository.

## Issues and Discussions

- Confirmed bugs, feature requests, and install failures: GitHub Issues (templates in `.github/ISSUE_TEMPLATE/`).
- Questions and ideas: [GitHub Discussions](https://github.com/yanshekki/ysk-server/discussions).
- Private contact: [email@ysk.hk](mailto:email@ysk.hk).
- Do not paste passwords, OTP / recovery codes, API keys, or `BOOTSTRAP-CREDENTIALS.txt`.

## Development

```bash
pnpm install && pnpm build
pnpm gates && pnpm docs:bilingual && pnpm test
```

Docs map: [docs/INDEX.md](docs/INDEX.md). Host writes stay dry-run until **root** + `YSK_EXECUTE=1`.

## Dependency updates

Dependabot opens weekly grouped **minor/patch** PRs for the pnpm workspace (`ysk-server`, `ysk-server-core`, `ysk-server-shared`, `apps/web`) and GitHub Actions. Security updates are enabled on the repo. Do not weaken CI to land a bump. Majors stay a human weekly review — same process as [docs/security/](docs/security/).

## Install CI

| When | What |
|------|------|
| Every PR / push to `main` | `scripts/ci-install-smoke.sh` on Ubuntu **22.04 / 24.04 / 26.04** containers (syntax, `--help`, checksums). |
| Weekly schedule + **Run workflow** | `install.sh --non-interactive --plan minimal --from-source --no-install-systemd` on that same matrix. Fresh from-source keeps the pnpm tree (no npm tarball overlay). |

Gates / Probe SSOT / Build & test in `.github/workflows/ci.yml` stay as they are. `recommended` / `full` still belong on a VPS (ufw, nginx, SQL).

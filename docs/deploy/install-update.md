# Deploy, Install, and Update

## One-click install

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash
```

`install.sh` will:

1. Detect OS (Ubuntu 22.04/24.04 preferred)
2. Install system deps (`curl`, `git`, `build-essential`, …)
3. Install Node.js LTS (NodeSource) if missing
4. Install `ysk-server` (npm global or `--from-source`)
5. Optionally run `ysk-server setup`
6. Print next steps

### Flags

| Flag | Meaning |
|------|---------|
| `--non-interactive` | No prompts |
| `--skip-setup` | Install only |
| `--upgrade` | Upgrade mode |
| `--from-source` | Build current checkout |

Safety: `set -euo pipefail`.

## Setup

```bash
ysk-server setup --non-interactive
ysk-server serve
```

## Self-update

```bash
ysk-server update --check
ysk-server update
# or
./install.sh --upgrade
```

Self-update plan steps: check → download → verify checksum → backup → replace → migrate → health-verify → audit; rollback path included.

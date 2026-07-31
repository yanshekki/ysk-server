# Runtimes

> Language: English | [中文](./runtimes-ZH.md)

**Panel routes:** `/runtimes/node`, `/runtimes/php`, …  
**CLI:** `hosting runtimes`, `hosting runtime-install`

## What it does

Probe installed toolchains and produce **install plans**. Multi-version awareness (e.g. Node 18/20/22, PHP 8.x).

| Runtime | Typical probe |
|---------|----------------|
| Node | `node`, npm/pnpm, optional PM2 |
| PHP | `php`, FPM pools |
| Python / Go / Rust | language binaries / cargo |

## CLI

```bash
ysk-server hosting runtimes --json
ysk-server hosting runtime-install --kind node --version 20 --json
ysk-server hosting runtime-install --kind php --version 8.3 --install --execute
```

## Workflow

1. Probe what is already on PATH.  
2. Review plan (packages, commands).  
3. `--execute` only with EXECUTE (apt often needs root).  
4. Re-probe; then deploy projects with that runtime.

## Honesty

Install without EXECUTE is blocked. “Toolchain installed” ≠ “project online” (still need deploy + nginx publish).

## Related

[projects.md](./projects.md) · [../cli/reference.md](../cli/reference.md)

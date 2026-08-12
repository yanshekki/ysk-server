# Runtimes

> Language: English | [中文](./runtimes-ZH.md)

## Purpose

Probe, install, switch, and uninstall **application runtimes** on the host: Node, PHP, Python, Go, Rust, **Java**, **Kotlin**, **Bun** — including multi-version awareness and optional plugins/extensions.

**Non-goals:** “Toolchain installed” alone does not put a project online (still need deploy + edge publish).

## Panel

| Item | Value |
|------|--------|
| Routes | `/runtimes/node`, `/php`, `/python`, `/go`, `/rust`, `/java`, `/kotlin`, `/bun` |
| Nav keys | `node`, `php`, `python`, `go`, `rust`, `java`, `kotlin`, `bun` |
| Main actions | Probe · install · switch default · uninstall · plugins / PHP extensions |
| Capability | Hosting runtime |
| RBAC | Hosting operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Probe / list | `ysk-server runtimes list --json` | read | also `hosting runtimes` |
| Install / plan | `ysk-server runtimes install --kind K --version V [--execute]` | write-host | plan without execute |
| Switch default | `ysk-server runtimes switch --kind K --version V --execute` | write-host | |
| Uninstall version | `ysk-server runtimes uninstall --kind K --version V --execute` | write-host | |
| Hosting aliases | `ysk-server hosting runtime-install\|runtime-switch\|runtime-uninstall` | write-host | same core |

Kinds: `node` · `php` · `python` · `go` · `rust` · `java` · `kotlin` · `bun`.

## CLI quick start

```bash
ysk-server runtimes list --json
ysk-server runtimes install --kind java --version 21 --json
export YSK_EXECUTE=1
ysk-server runtimes install --kind java --version 21 --execute --json
ysk-server runtimes switch --kind node --version 20 --execute --json
```

Full argv: [../cli/reference.md](../cli/reference.md#runtimes).

## Honesty

- Install without EXECUTE is blocked for live packages.  
- Switching/uninstalling managed versions may require root.  
- Deploy projects separately after toolchain is ready.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Live SSE install log terminal | Interactive stream; CLI prints final JSON |

## Related

- [Projects](./projects.md)  
- [Panel ↔ CLI matrix](../cli/panel-parity-matrix.md)  
- [CLI reference — runtimes](../cli/reference.md#runtimes)  

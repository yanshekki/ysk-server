# Host Browse

> Language: English | [中文](./host-browse-ZH.md)

## Purpose

Interactive **Chromium session UI** for browsing from the control plane (panel-only surface).

**Non-goals:** Replacing VNC/desktop; remote SSH product.

## Panel

| Item | Value |
|------|--------|
| Route | Host Browse UI |
| Nav key | `hostBrowse` |
| Main actions | Session list · open browser surface |
| Capability | Host browse |
| RBAC | Operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Interactive browser | — | ⚠️ panel-only | intentional |
| (Optional future) session list | — | — | not required for seal |

## CLI quick start

No production CLI. Use [VNC](./vnc.md) or SSH for remote desktop/shell needs.

## Honesty

- Documented as **panel-only** in the parity matrix.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Entire Host Browse Chromium UI | Interactive browser surface |

## Related

- [Panel ↔ CLI matrix](../cli/panel-parity-matrix.md) · [VNC](./vnc.md)  

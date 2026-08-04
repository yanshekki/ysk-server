# Unified host software probe

> Language: English | [中文](./software-probe-ZH.md)

## Rule

**All product checks for “is this software installed?”, “what version?”, and “is there an upgrade?” must go through `HostSoftwareProbe`.**

Do **not** re-implement `command -v`, ad-hoc `hasBin`, or engine-specific flavor logic in service-console, db-engine, redis-browser, stack, or pages.

| Concern | API |
|---------|-----|
| Installed? | `probe.presence(id)` / `probe.isInstalled(id)` |
| Version | `probe.version(id)` |
| Upgrade candidate | `probe.upgrade(id)` / `probe.upgrades()` |
| Bare bin (non-catalog tools) | `probe.resolveBin(name)` / `probe.binPresent(name)` — same PATH rules |

Module: `packages/core/src/hosting/software-probe/`  
Class: `HostSoftwareProbe`  
Registry: `SOFTWARE_CATALOG` + exclusive/version metadata in `registry.ts`.

## Exclusive engines (MySQL vs MariaDB)

`mysql-server` and `mariadb-server` are **exclusive**:

- Host flavor is detected once (`detectSqlFlavor`).
- If MariaDB owns the host → `presence('mysql-server').installed === false` and `blockedByExclusive === 'mariadb-server'`.
- Service console engine `mysql` uses the same `presence('mysql-server')` — **not** “mysqld OR mysql client”.

This keeps **MySQL databases page** and **MySQL service page** consistent.

## Callers (migrated)

- `probeSoftware` → `HostSoftwareProbe.presence`
- `probeDbEngine` → presence + version
- `getServiceConsole` → `presenceForEngine`
- `stack/ops` getStackStatus → presence / `binPresent`

## Adding a catalog software

1. Add to `SOFTWARE_CATALOG` (`software-catalog.ts`).
2. Optionally set version command / dpkg name / exclusive in `software-probe/registry.ts`.
3. Use only `HostSoftwareProbe` from features — never new PATH snippets.

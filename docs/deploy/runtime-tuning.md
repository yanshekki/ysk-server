# Runtime tuning

> Language: English | [中文](./runtime-tuning-ZH.md)

## Purpose

Document env/tuning knobs for Node/PHP/Python/Go/Rust managed by the panel (thread pools, memory hints, php.ini catalog, etc.).

Operational install still goes through [../features/runtimes.md](../features/runtimes.md).

```bash
ysk-server hosting runtimes --json
```

## Honesty

Tuning files under dataDir need EXECUTE to affect live processes/pools.

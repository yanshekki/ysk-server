# YSK Server CLI Reference

Binary: **`ysk-server`**

## Global

```
ysk-server --help
ysk-server --version
ysk-server <command> --json
```

## Commands

### setup

Initialize control-plane config skeleton.

```
ysk-server setup [--data-dir PATH] [--host HOST] [--port PORT]
                 [--locale zh-TW|en|zh-CN] [--non-interactive]
                 [--dry-run] [--force]
```

### update

Self-update check / plan (migrate, verify, rollback steps).

```
ysk-server update [--check] [--latest VERSION] [--json]
```

### serve

Start control-plane HTTP server.

```
ysk-server serve [--host 127.0.0.1] [--port 8787]
```

### tools

List allowlisted tools (schema discovery for AI agents).

```
ysk-server tools --json
```

### agents

List managed AI agent runtimes (OpenClaw, Hermes, IonClaw).

```
ysk-server agents --json
```

## AI-agent friendly output

Prefer `--json` for structured results with `ok`, `code`, `message`, `data`.

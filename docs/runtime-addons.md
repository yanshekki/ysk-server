# Runtime install & add-ons (SSOT)

## UI entry points

| Route | Page implementation |
|-------|---------------------|
| `/runtimes/node` | `GenericRuntimePage kind=node` (via `NodeRuntimePage` re-export) |
| `/runtimes/php` | `PhpRuntimePage` (ini/FPM + apt extensions) |
| `/runtimes/{python,go,rust,java,kotlin,bun}` | `GenericRuntimePage` |

## Install body

`POST /api/v1/hosting/runtimes/install`

```json
{
  "kind": "node",
  "version": "20",
  "install": true,
  "plugins": ["pm2"],
  "extensions": ["mysql", "gd"]
}
```

- `extensions` — **PHP only** (apt `phpX.Y-*`)
- `plugins` — node/python/go/rust/java/kotlin/bun companion tools

## Catalogs

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/hosting/runtimes/addons?kind=&version=` | **Preferred** unified catalog (probes `installed`) |
| `GET /api/v1/hosting/runtimes/plugins?kind=` | Legacy plugins-only |
| `GET /api/v1/hosting/php/extensions?version=` | PHP extensions + host probe (`php -m` / dpkg) |
| `GET /api/v1/hosting/runtimes/latest?kind=` | Optional remote latest hint (24h cache) |
| `POST /api/v1/hosting/runtimes/plugins/uninstall` | Uninstall companion tools `{ kind, plugins[] }` |

### Install vs uninstall UX

- **Available**: multi-select only tools/extensions **not** already on host.
- **Installed**: listed separately; companion tools support **Uninstall** (confirm).
- PHP: installed extensions hidden from install multi-select (core still listed as required).
- Go uninstall only removes binaries under `go/bin` / `/usr/local/ysk/**` (never system `/usr/bin`).

## Panel TLS

Config keys: `tlsEnabled`, `tlsCertPath`, `tlsKeyPath`, `panelDomain`, `httpListenPort`, `tlsHttpRedirect`.

- HTTPS on `listenPort`
- Optional dual HTTP on `httpListenPort` (default `listenPort-1`) with 301 → HTTPS
- Issue: certbot webroot → nginx certonly → standalone (no `--redirect`)

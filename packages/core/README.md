<p align="center">
  <img src="https://raw.githubusercontent.com/yanshekki/ysk-server/main/apps/web/public/logo.svg" width="56" alt="YSK Server" />
</p>

<h1 align="center">ysk-server-core</h1>

<p align="center">
  Hosting, security, and apply logic for
  <a href="https://www.npmjs.com/package/ysk-server"><strong>YSK Server</strong></a>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ysk-server-core"><img alt="ysk-server-core" src="https://img.shields.io/npm/v/ysk-server-core.svg?style=flat-square&color=2ea043" /></a>
  <a href="https://www.npmjs.com/package/ysk-server"><img alt="product" src="https://img.shields.io/npm/v/ysk-server.svg?style=flat-square&color=2ea043&label=ysk-server" /></a>
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-2ea043?style=flat-square" />
</p>

Operators should install the **product**, not this library:

```bash
npm install -g ysk-server
```

Host mutations stay honest: **root** + `YSK_EXECUTE=1`, or the result is dry-run / blocked.

| | |
|:--|:--|
| **Product** | [ysk-server](https://www.npmjs.com/package/ysk-server) |
| **Depends on** | [ysk-server-shared](https://www.npmjs.com/package/ysk-server-shared) |
| **Source** | [github.com/yanshekki/ysk-server](https://github.com/yanshekki/ysk-server) (`packages/core`) |
| **License** | MIT |

This package is **bundled** inside `ysk-server`. You do not need to depend on it unless you are extending the monorepo.

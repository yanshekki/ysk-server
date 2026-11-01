# Supply-chain review — 2026-11-01

> Language: English | [中文](./2026-11-01-supply-chain-ZH.md)

Review for YSK Server **1.1.33**. `pnpm audit` after the lockfile update reports **one** remaining advisory (`ip`). No new npm advisory since 1.1.32. Dependabot alert #1 is that same `ip` issue. There were no open pull requests.

## Scope

Published packages `ysk-server`, `ysk-server-shared`, and `ysk-server-core`, the private panel `apps/web`, the pnpm 9.15.9 lockfile (`lockfileVersion` 9.0), GitHub Actions, and `install.sh` plus the installer libraries it fetches (`install/lib/*.sh`: NodeSource, rustup, Bun, and the Kotlin compiler zip).

## Method

`pnpm audit` (400 dependencies: 1 high, 0 critical, 0 moderate, 0 low), `pnpm outdated -r`, `npm view` for direct dependencies and installer pins, lockfile inspection, GitHub Actions tag commits, and a read of `bittorrent-tracker@11.2.3` `lib/server/parse-udp.js`. Native addons in this tree: `node-pty@1.1.0` (prebuilds; `install.sh` runs `npm rebuild node-pty`), `ws` optional peers `bufferutil@4.1.0` and `utf-8-validate@6.0.6` via `node-gyp-build@4.8.4`, and WebTorrent's `node-datachannel@0.32.3` (pulls deprecated `prebuild-install@7.1.3`). `fetch-blob` pulls deprecated `node-domexception@1.0.0`. Neither deprecation is an audit finding. `sql.js` is asm/WASM, not a Node native addon. The store still loads `sql.js/dist/sql-asm.js`. 1.15.2 prints a deprecation warning and points at `sql-wasm-inline.js`; the loader was not switched. No package name in the tree is a known typosquat of a direct dependency.

GitHub secret scanning and push protection are enabled. Dependabot security updates are enabled. Code scanning has no analysis configured. Discussions are enabled.

## Results

### Fixed

| Component | Severity | Advisory | Status |
|-----------|----------|----------|--------|
| Roundcube default | High (upstream) | Roundcube 1.7.5 security release, 2026-10-19 | **1.7.5**. New webmail installs and the generated `install-roundcube.sh` helper default move off **1.7.2**. Upstream notes cover IMAP command injection, an SSRF filter bypass (NAT64), remote-content and XSS issues, a CSRF bypass on mark-as-junk, and session object injection. `roundcubemail-1.7.5-complete.tar.gz` returns HTTP 200. A tree already on disk is not rewritten until webmail is installed again. |
| @simplewebauthn/server repair | — | installer drift after 1.1.32 | **14.0.3**. `install.sh` repaired a missing module with **13.3.3** after core moved to 14. Installer smoke now requires the repair pin to match `packages/core`. |
| ws | — | maintenance | **8.22.1**. IPC URL paths are no longer truncated at `:`. Masking uses Node's `http.websocketMask` / `websocketUnmask` when those functions exist. |
| sql.js | — | maintenance | **1.15.2**. Export uses SQLite's backup API and keeps the source connection open. The asm.js build is still shipped. |
| react-router-dom | — | maintenance | **7.18.5**. Route-manifest processing is bounded for expensive ancestor expansion. turbo-stream decoding checks are tighter. The panel is a Vite SPA. |
| i18next | — | maintenance | **26.6.0** (lockfile was 26.5.11). `strictInterpolationChecks` defaults to false. The panel keeps `enableSelector: false`, so string keys stay strings. |
| @types/node | — | maintenance | **26.6.6**. Dev types only. Runtime engines stay Node ≥22. CI stays Node 24. |
| Prior remediations | — | still hold | happy-dom **21.0.4**, `source-map-js` **1.2.2**, `ip-address` **10.7.5**, brace-expansion and nanoid overrides, Vitest **5.0.5**, Vite **8.3.5**, SimpleWebAuthn server **14.0.3** and browser **14.0.0**. |

### Unfixed

| Component | Severity | Advisory | Status |
|-----------|----------|----------|--------|
| ip 2.0.1 | High | GHSA-2p57-rm9w-gvfp | **Unfixed upstream.** Latest is still 2.0.1 (registry `modified` 2025-10-13). No `2.0.2`. Dependabot alert #1. Runtime via `bittorrent-tracker@11.2.3` (latest; still `ip@^2.0.1`) from core and panel WebTorrent **3.0.21**. |
| NodeSource setup | — | `curl \| bash` of `setup_24.x` | **Accepted.** `install/lib/stack-ops.sh` pipes `https://deb.nodesource.com/setup_24.x`. The script is unpinned. Replacing it would change how Node 24 is installed on Ubuntu. |
| rustup / Bun | — | `curl \| bash` | **Accepted.** Optional stack components only: `https://sh.rustup.rs` and `https://bun.sh/install`. Not on the default install path. |
| Asset checksums | — | optional unless `YSK_INSTALL_REQUIRE_CHECKSUMS=1` | **Mitigated, not mandatory.** When `install/checksums.sha256` is reachable it is verified. A missing file still warns and continues. |
| pnpm 10 / 11 / 12 | — | major package-manager upgrades | **Deferred.** Latest 9.x is **9.15.9**. pnpm 12.17.0 would rewrite the lockfile and the `packageManager` pin. |
| TypeScript 6 / 7 | — | major | **Deferred.** Latest 5.x is **5.9.3**. Latest overall is **7.0.2** (6.0.3 also exists). |
| npm CLI 12 | — | major | **Deferred.** Release workflow stays **npm@11.21.1** (latest 11.x). npm 12.2.1 is not used. Publish stays Trusted Publisher OIDC. No npm token. |
| pm2 7 | — | major | **Deferred.** Installer pins **6.0.14** (latest 6.x). Latest overall is 7.1.1. |

`ip` exposure, re-checked on `bittorrent-tracker@11.2.3`: `lib/server/parse-udp.js` calls `ip.toString()` once, to turn the optional 32-bit address in a UDP announce into a dotted string. It does not call `isPublic`, `isPrivate`, or `isLoopback`. Those classifiers are what GHSA-2p57-rm9w-gvfp gets wrong. Peer addresses here are tracker swarm data, not a guard before an outbound request. Panel DDNS uses `isPublicIpv4` / `isPublicIpv6` in `packages/core` (own code, not the `ip` package). No override was applied: there is no patched `ip@2.0.2`, and an unreviewed fork would be a new supply-chain dependency. Revisit when `bittorrent-tracker` drops `ip`.

## Deferred upgrades

| Package | Latest seen | Why it stays |
|---------|-------------|--------------|
| TypeScript | 7.0.2 | Major (6.0.3 and 7.0.2). Stays on **5.9.3**. |
| pnpm | 12.17.0 | Breaking major. Latest 9.x is **9.15.9**. |
| npm CLI | 12.2.1 | Major. Release workflow stays **11.21.1**. |
| pm2 | 7.1.1 | Installer pins **6.0.14** so a fresh host does not take an untested major. |
| nanoid | 6.0.2 | Major. The tree resolves **3.3.20**. Overrides still lift vulnerable 3.x / 4.x / 5.x ranges to 3.3.20 / 5.1.16. 5.1.16 is the latest 5.x. |
| sql.js loader | wasm-inline | 1.15.2 deprecates asm.js and still ships `sql-asm.js`. The store keeps that path. Switching loaders is a runtime change, not this patch. |
| SnappyMail tag 2.38.2.1 | docker only | Tag notes a PHP 8.2.35 pin for CVE-2026-109618 / CVE-2026-109619 in the `djmaze/snappymail` image ([snappymail#2085](https://github.com/the-djmaze/snappymail/issues/2085)). No `snappymail-2.38.2.1.tar.gz` (HTTP 404). YSK installs the **2.38.2** application tarball onto host PHP, not that image. |
| Kotlin compiler zip | not moved | Optional stack install pins **2.1.0**, fallback **2.0.21**. Not a default `install.sh` fetch. No reviewed security patch required a new compiler line. |

Direct dependencies checked and already current: Vitest **5.0.5**, Vite **8.3.5**, `@vitejs/plugin-react` **6.1.2**, happy-dom **21.0.4**, playwright-core **1.64.1**, WebTorrent **3.0.21**, `bittorrent-tracker` **11.2.3**, `node-pty` **1.1.0**, `node-gyp-build` **4.8.4**, React **19.3.1**, `react-i18next` **17.1.9**, tsx **4.23.15**, maxmind **5.0.7**. Resolved esbuild is **0.28.2**. The override still lifts `esbuild@<=0.24.2` to **0.25.12** (latest 0.25.x).

## Installer and Actions

`install.sh` fetches installer libraries over HTTPS from `raw.githubusercontent.com` (default branch `main`; `YSK_INSTALL_RAW` can pin a commit) and, when present, checks `install/checksums.sha256`. Fallback package download is `https://registry.npmjs.org/ysk-server/-/ysk-server-<version>.tgz`. Global pins: `pnpm@9.15.9`, `node-gyp-build@4.8.4`, `pm2@6.0.14`, repair `@simplewebauthn/server@14.0.3`.

Fetched `install/lib/stack-ops.sh` still pipes NodeSource `setup_24.x`, rustup, and Bun, and downloads a Kotlin compiler zip. Those pipes are the remaining installer trust boundary. Checksums cover the library files, not the third-party scripts those libraries curl.

Actions stay SHA-pinned to the current release commits, not the moving tags. No newer release of these three this week.

| Action | Pin | Release |
|--------|-----|---------|
| actions/checkout | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 (2026-07-17) |
| actions/setup-node | `949feb2413d6458794dcd2491c4babbbce0c15c1` | v7.1.0 (2026-10-08) |
| pnpm/action-setup | `ea17c68df8912ef543352723c149a84f56e3d413` | v6.1.0 (annotated tag; commit 2026-09-04) |

Release workflow npm CLI is **11.21.1**. The npm 11 warning `bin[ysk-server] ... invalid and removed` is a false alarm and is ignored.

## Re-check

```bash
pnpm audit
```

Expected: one high advisory, `ip` ≤2.0.1, GHSA-2p57-rm9w-gvfp. No critical. No moderate.

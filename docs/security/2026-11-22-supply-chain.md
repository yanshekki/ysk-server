# Supply-chain review — 2026-11-22

> Language: English | [中文](./2026-11-22-supply-chain-ZH.md)

Review for YSK Server **1.1.37**. `pnpm audit` after the lockfile update reports **one** remaining advisory (`ip`). No new npm advisory since 1.1.36. Dependabot alert #1 is that same `ip` issue.

## Scope

Published packages `ysk-server`, `ysk-server-shared`, and `ysk-server-core`, the private panel `apps/web`, the pnpm 9.15.9 lockfile (`lockfileVersion` 9.0), GitHub Actions, and `install.sh` plus the installer libraries it fetches (`install/lib/*.sh`: NodeSource, rustup, Bun, and the Kotlin compiler zip).

## Method

`pnpm audit` (421 dependencies: 1 high, 0 critical, 0 moderate, 0 low), `pnpm outdated -r`, `npm view` for direct dependencies and installer pins, lockfile inspection, GitHub Actions tag commits, a read of `bittorrent-tracker@11.2.3` `lib/server/parse-udp.js`, listing the SnappyMail **3.1.4** application tarball, and a HEAD of `roundcubemail-1.7.6-complete.tar.gz`. Native addons in this tree: `node-pty@1.1.0` (prebuilds; `install.sh` runs `npm rebuild node-pty`), `ws` optional peers `bufferutil@4.1.0` and `utf-8-validate@6.0.6` via `node-gyp-build@4.8.4`, and WebTorrent's `node-datachannel@0.32.3` (pulls deprecated `prebuild-install@7.1.3`). `fetch-blob` pulls deprecated `node-domexception@1.0.0`. Neither deprecation is an audit finding. `sql.js` is asm/WASM, not a Node native addon. The store still loads `sql.js/dist/sql-asm.js` (present in 1.17.0). No package name in the tree is a known typosquat of a direct dependency.

GitHub secret scanning and push protection are enabled. Dependabot security updates are enabled. Code scanning has no analysis configured. Discussions are enabled.

Open Dependabot PRs **#28** (react-i18next 18.0.1) and **#29** (i18next 27.1.1) were left open and were **not** merged. They must move together, and only after explicit consent. Consent requested 2026-11-16 has not been given.

## Results

### Fixed

| Component | Severity | Advisory | Status |
|-----------|----------|----------|--------|
| SnappyMail default | — | 3.1.4 application minor, 2026-11-20 | **3.1.4**. New installs move off **3.0.1**. `snappymail-3.1.4.tar.gz` exists (HTTP 200). Layout is still flat `index.php` + `_include.php` + `snappymail/` (installer branch 3). Domain JSON still has `shortLogin` (default `false`). `integrity.php` requires PHP ≥ 8.2 (product default). 3.1.0–3.1.2 had new-install bugs; 3.1.4 is the first 3.1.x used (also `json_validate` / `array_first` on PHP 8.2). A tree already on disk is not rewritten until webmail is installed again. |
| source-map-js override | — | maintenance / CSP | **1.2.4**. Override lifts `<1.2.4` to 1.2.4. 1.2.3 stops using `new Function` (CSP `unsafe-eval`). 1.2.4 is index-map and TypeScript fixes. |
| sql.js | — | maintenance | **1.17.0**. Still ships `sql-asm.js`. Additive SQLite error `code` / `errcode` and `SQL.constants`. `BigInt` bind parameters use int64 instead of text; the store does not pass `BigInt`. |
| Vitest / coverage | — | maintenance | Vitest **5.1.1**, `@vitest/coverage-v8` **5.1.1**. Patch: cache, coverage, and worker teardown fixes. |
| react-router-dom / user-event | — | maintenance | `react-router-dom` **7.18.6**, `@testing-library/user-event` **14.6.13**. |
| npm CLI 11.x | — | maintenance | Release workflow **11.21.3** (latest 11.x). |
| Prior remediations | — | still hold | Roundcube **1.7.6**, SnappyMail security line **3.x**, happy-dom **21.0.4**, nanoid / `ip-address` / brace-expansion / esbuild overrides, Vite 8 / Vitest 5 / SimpleWebAuthn 14 / TypeScript **7.0.2**. |

### Unfixed

| Component | Severity | Advisory | Status |
|-----------|----------|----------|--------|
| ip 2.0.1 | High | GHSA-2p57-rm9w-gvfp | **Unfixed upstream.** Latest is still 2.0.1 (published 2024-02-19). No `2.0.2`. Dependabot alert #1. Runtime via `bittorrent-tracker@11.2.3` (latest; still `ip@^2.0.1`) from core and panel WebTorrent **3.0.21**. |
| NodeSource setup | — | `curl \| bash` of `setup_24.x` | **Accepted.** `install/lib/stack-ops.sh` pipes `https://deb.nodesource.com/setup_24.x`. The script is unpinned. Replacing it would change how Node 24 is installed on Ubuntu. |
| rustup / Bun | — | `curl \| bash` | **Accepted.** Optional stack components only: `https://sh.rustup.rs` and `https://bun.sh/install`. Not on the default install path. |
| Asset checksums | — | optional unless `YSK_INSTALL_REQUIRE_CHECKSUMS=1` | **Mitigated, not mandatory.** When `install/checksums.sha256` is reachable it is verified. A missing file still warns and continues. |
| pnpm 10 / 11 / 12 | — | major package-manager upgrades | **Deferred.** Latest 9.x is **9.15.9**. pnpm 12.21.0 would rewrite the lockfile and the `packageManager` pin. |
| i18next 27 / react-i18next 18 | — | major | **Deferred.** Latest 26.x is **26.7.2**. Latest 17.x is **17.1.13**. 27.2.3 / 18.0.3 need a dedicated pass together (`fallbackLng` default, selector types, react-i18next 18 peers i18next ≥ 27.0.1). Open PRs #28 and #29 are not merged. |
| npm CLI 12 | — | major | **Deferred.** Release workflow stays **npm@11.21.3** (latest 11.x). npm 12.2.3 is not used. Publish stays Trusted Publisher OIDC. No npm token. |
| pm2 7 | — | major | **Deferred.** Installer pins **6.0.14** (latest 6.x). Latest overall is 7.1.2. |
| @testing-library/jest-dom 8 | — | major | **Deferred.** Latest 7.x is **7.0.1**. 8.0.0 only drops Vitest &lt;5 (this repo already runs 5.1). Keep for a dedicated pass. |

`ip` exposure, re-checked on `bittorrent-tracker@11.2.3`: `lib/server/parse-udp.js` calls `ip.toString()` once, to turn the optional 32-bit address in a UDP announce into a dotted string. It does not call `isPublic`, `isPrivate`, or `isLoopback`. Those classifiers are what GHSA-2p57-rm9w-gvfp gets wrong. Peer addresses here are tracker swarm data, not a guard before an outbound request. Panel DDNS uses `isPublicIpv4` / `isPublicIpv6` in `packages/core` (own code, not the `ip` package). No override was applied: there is no patched `ip@2.0.2`, and an unreviewed fork would be a new supply-chain dependency. Revisit when `bittorrent-tracker` drops `ip`.

## Deferred upgrades

| Package | Latest seen | Why it stays |
|---------|-------------|--------------|
| i18next | 27.2.3 | Major. Stays on **26.7.2** (last 26.x). Dependabot #29 failed CI; must land with react-i18next 18 after consent. |
| react-i18next | 18.0.3 | Major, pairs with i18next 27 (peer ≥ 27.0.1). Stays on **17.1.13**. Dependabot #28 is incomplete alone. |
| pnpm | 12.21.0 | Breaking major. Latest 9.x is **9.15.9**. `next-12` is 12.22.0. |
| npm CLI | 12.2.3 | Major. Release workflow stays **11.21.3**. |
| pm2 | 7.1.2 | Installer pins **6.0.14** so a fresh host does not take an untested major. |
| @testing-library/jest-dom | 8.0.0 | Major. Stays on **7.0.1**. Only breaking change is dropping Vitest &lt;5. |
| nanoid | 6.0.2 | Major. The tree resolves **3.3.20**. Overrides still lift vulnerable 3.x / 4.x / 5.x ranges to 3.3.20 / 5.1.16. 5.1.16 is the latest 5.x. |
| sql.js loader | wasm-inline | 1.17.0 still ships `sql-asm.js` and still deprecates asm.js. Native SQLite math is on; legacy functions stay enabled by default. The store keeps `sql-asm.js`. Switching loaders is a runtime change, not this patch. |
| Kotlin compiler zip | 2.4.21 | Optional stack install pins **2.1.0**, fallback **2.0.21**. Latest stable is 2.4.21; 2.5.0 is still RC. Not a default `install.sh` fetch. No reviewed security patch required a new compiler line. |

Direct dependencies checked and already current: happy-dom **21.0.4**, WebTorrent **3.0.21**, `bittorrent-tracker` **11.2.3**, `node-pty` **1.1.0**, `node-gyp-build@4.8.4`, React **19.3.1**, tsx **4.23.15**, TypeScript **7.0.2**, `@types/node` **26.6.6**, `@simplewebauthn/server` **14.1.0**, `@simplewebauthn/browser` **14.0.0**, Vite **8.3.8**, `@vitejs/plugin-react` **6.3.0**, `playwright-core` **1.65.1**, `ws` **8.23.0**, maxmind **5.1.0**. Resolved esbuild is **0.28.2**. The override still lifts `esbuild@<=0.24.2` to **0.25.12** (latest 0.25.x). `bufferutil@4.2.0` exists; the tree keeps the optional **4.1.0** peer (no advisory). `utf-8-validate@6.1.0` exists; the tree keeps the optional **6.0.6** peer (no advisory).

## Installer and Actions

`install.sh` fetches installer libraries over HTTPS from `raw.githubusercontent.com` (default branch `main`; `YSK_INSTALL_RAW` can pin a commit) and, when present, checks `install/checksums.sha256`. Fallback package download is `https://registry.npmjs.org/ysk-server/-/ysk-server-<version>.tgz`. Global pins: `pnpm@9.15.9`, `node-gyp-build@4.8.4`, `pm2@6.0.14`, repair `@simplewebauthn/server@14.1.0`.

Fetched `install/lib/stack-ops.sh` still pipes NodeSource `setup_24.x`, rustup, and Bun, and downloads a Kotlin compiler zip. Those pipes are the remaining installer trust boundary. Checksums cover the library files, not the third-party scripts those libraries curl.

Actions stay SHA-pinned to the current release commits, not the moving tags. No newer release of these three.

| Action | Pin | Release |
|--------|-----|---------|
| actions/checkout | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 (2026-07-17) |
| actions/setup-node | `949feb2413d6458794dcd2491c4babbbce0c15c1` | v7.1.0 (2026-10-08) |
| pnpm/action-setup | `73e46992e05b19abd31f2f3c20e0e7370d762115` | v6.1.1 (2026-11-03) |

Release workflow npm CLI is **11.21.3**. The npm 11 warning `bin[ysk-server] ... invalid and removed` is a false alarm and is ignored.

## Re-check

```bash
pnpm audit
```

Expected: one high advisory, `ip` ≤2.0.1, GHSA-2p57-rm9w-gvfp. No critical. No moderate.

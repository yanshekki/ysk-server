# Supply-chain review — 2026-10-18

> Language: English | [中文](./2026-10-18-supply-chain-ZH.md)

Review for YSK Server **1.1.29**. `pnpm audit` after the lockfile update reports **one** remaining advisory (`ip`). No new advisory appeared after 1.1.28. 1.1.28 remediations still hold.

## Scope

Published packages `ysk-server`, `ysk-server-shared`, and `ysk-server-core`, the private panel `apps/web`, the pnpm 9.15.9 lockfile, GitHub Actions, and `install.sh` (npm globals, asset checksums, NodeSource).

## Method

`pnpm audit` (direct and transitive), `pnpm outdated -r`, lockfile inspection, and a read of runtime imports. Native addons were present in this environment (`node-pty` prebuilds; `bufferutil` and `utf-8-validate` via `node-gyp-build@4.8.4`). No package name in the tree is a known typosquat of a direct dependency.

## Results

### Fixed

| Component | Severity | Advisory | Status |
|-----------|----------|----------|--------|
| vitest / @vitest/coverage-v8 (dev) | — | maintenance | **4.1.12** (still 4.x). Vitest 5 was not required. |
| playwright-core | — | maintenance | **1.64.1**. |
| sql.js | — | maintenance | **1.15.0** (SQLite wasm 3.54.0). asm.js builds remain in the package; the store still loads `sql.js/dist/sql-asm.js`. |
| @testing-library/user-event (dev) | — | maintenance | **14.6.8**. |
| nanoid 3.x (dev override) | — | maintenance | Override `nanoid@>=3 <3.3.20` → **3.3.20**. 3.3.19's "huge user ID" fix still holds; 3.3.20 is a types patch. |
| ip-address (override) | — | maintenance | Override `ip-address@<10.7.4` → **10.7.4**. The original CVE floor (≥10.7.1) still holds. |
| esbuild (tsx, dev) | — | maintenance | **0.28.2** via tsx `~0.28.0`. Vite remains on **0.25.12** (override `esbuild@<=0.24.2` unchanged). |
| 1.1.28 remediations | — | still hold | `source-map-js` **1.2.2**, Vite **6.4.4**, happy-dom **20.14.6**, Vitest 4.x advisories, overrides for `brace-expansion` / nanoid 5.x / `esbuild` ≤0.24.2, Actions SHA pins, `install.sh` `pnpm@9.15.9` / `node-gyp-build@4.8.4` / `pm2@6.0.14`. |

### Unfixed

| Component | Severity | Advisory | Status |
|-----------|----------|----------|--------|
| ip 2.0.1 | High | GHSA-2p57-rm9w-gvfp | **Unfixed upstream** (no patched release; latest is still 2.0.1). Runtime via `bittorrent-tracker@11.2.3` (core WebTorrent 3.0.21 and panel WebTorrent 2.8.5). |
| NodeSource setup | — | `curl \| bash` of `setup_24.x` | **Accepted.** The script is unpinned. Replacing it would change how Node 24 is installed on Ubuntu. |
| Asset checksums | — | optional unless `YSK_INSTALL_REQUIRE_CHECKSUMS=1` | **Mitigated, not mandatory.** When `install/checksums.sha256` is reachable it is verified. A missing file still warns and continues, so a one-liner against a base without the file does not fail closed. |
| pnpm 10 / 11 / 12 | — | major package-manager upgrades | **Deferred.** See below. The lockfile stays pnpm 9. |

`ip` exposure: `bittorrent-tracker` calls `ip.toString()` once, in `lib/server/parse-udp.js`, to turn the optional 32-bit address in a UDP announce into a dotted string. It does **not** call `isPublic`, `isPrivate`, or `isLoopback`. Those classifiers are what GHSA-2p57-rm9w-gvfp gets wrong, and they are the SSRF footgun. Peer addresses here are tracker swarm data, not a guard before an outbound request. Panel DDNS uses `isPublicIpv4` / `isPublicIpv6` in `packages/core` (own code, not the `ip` package). No override was applied: there is no patched `ip@2.0.2`, and swapping in an unreviewed fork would be a new supply-chain dependency. Revisit when `bittorrent-tracker` drops `ip`.

## Deferred upgrades

| Package | Latest seen | Why it stays |
|---------|-------------|--------------|
| TypeScript | 7.0.2 | Major. Stays on **5.9.3**. |
| Vite | 8.3.4 | Major. **6.4.4** is still the latest 6.x. No 6.x advisory required a Vite 7/8 migration. |
| React / react-dom | 19.3.1 | Major. Panel stays on 18.3.1. |
| i18next | 26.5.2 | Major. Stays on 24.2.3; `react-i18next` stays on 15.7.4. |
| @simplewebauthn/server and browser | 14.0.3 | Major. Server stays **13.3.3**; browser stays **13.3.0** (latest 13.x). `install.sh` still repairs `@simplewebauthn/server@13.3.3`. |
| webtorrent (apps/web) | 3.0.21 | 2 → 3 is the breaking jump called out for the panel. Panel stays **2.8.5**. Core is already on 3.0.21. |
| pnpm | 12.14.0 | pnpm 12 is a breaking major. pnpm 10/11 would rewrite the lockfile and the `packageManager` pin. Stays **9.15.9**. |
| Vitest 5 | 5.0.5 | 4.1.12 already stays on the 4.x line that cleared the Vitest advisories. Vitest 5 is a further major and was not required. |
| pm2 | 7.0.4 | Installer pins 6.0.14 so a fresh host does not take an untested major. |

Also not bumped (majors or line jumps): `@types/node` 22 → 26, `@vitejs/plugin-react` 4 → 6, `react-i18next` 15 → 17, happy-dom 20 → **21.0.3**.

## Installer and Actions

`install.sh` still fetches installer libraries over HTTPS and, when present, checks `install/checksums.sha256`. Node.js still comes from NodeSource `setup_24.x`. That pipe is the remaining installer trust boundary. Pins are unchanged: `pnpm@9.15.9`, `node-gyp-build@4.8.4`, `pm2@6.0.14`.

Actions stay on the v4 line. The pin is the v4.4.0 commit, not the moving `v4` tag.

## Re-check

```bash
pnpm audit
```

Expected: one high advisory, `ip` ≤2.0.1, GHSA-2p57-rm9w-gvfp. No critical. No moderate. `source-map-js` is gone from the report.

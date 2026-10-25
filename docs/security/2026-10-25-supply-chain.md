# Supply-chain review — 2026-10-25

> Language: English | [中文](./2026-10-25-supply-chain-ZH.md)

Review for YSK Server **1.1.30**. `pnpm audit` after the lockfile update reports **one** remaining advisory (`ip`). The new high `happy-dom` advisory is cleared. 1.1.29 remediations still hold.

## Scope

Published packages `ysk-server`, `ysk-server-shared`, and `ysk-server-core`, the private panel `apps/web`, the pnpm 9.15.9 lockfile, GitHub Actions, and `install.sh` (npm globals, asset checksums, NodeSource).

## Method

`pnpm audit` (direct and transitive), `pnpm outdated -r`, lockfile inspection, and a read of runtime imports. Native addons were present in this environment (`node-pty` prebuilds; `bufferutil` and `utf-8-validate` via `node-gyp-build@4.8.4`). No package name in the tree is a known typosquat of a direct dependency.

## Results

### Fixed

| Component | Severity | Advisory | Status |
|-----------|----------|----------|--------|
| happy-dom (dev) | High | GHSA-834v-8h66-3h79 | **21.0.4**. Incomplete CVE-2026-33943 fix (unsanitized import alias / ESM compiler injection) plus opaque-origin `data:` iframe isolation. 20.x has no patch (`<=21.0.3` is listed vulnerable). Override `happy-dom@>=17 <21.0.4` → **21.0.4**. Dev-only (Vitest environment). Safer 21.x defaults keep CSS/iframe loading off. |
| Vite (dev) | — | maintenance | **6.4.5** (still 6.x). `server.fs` is checked after query stripping. No Vite GHSA in `pnpm audit`. Vite 8 was not required. |
| sql.js | — | maintenance | **1.15.1**. asm.js builds remain; the store still loads `sql.js/dist/sql-asm.js`. |
| ip-address (override) | — | maintenance | Override `ip-address@<10.7.5` → **10.7.5**. The original CVE floor (≥10.7.1) still holds. |
| 1.1.29 remediations | — | still hold | Vitest **4.1.12**, `playwright-core` **1.64.1**, `@testing-library/user-event` **14.6.8**, `source-map-js` **1.2.2**, overrides for `brace-expansion` / nanoid 3.x **3.3.20** / nanoid 5.x / `esbuild` ≤0.24.2, Actions SHA pins, `install.sh` `pnpm@9.15.9` / `node-gyp-build@4.8.4` / `pm2@6.0.14`. |

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
| Vite | 8.3.5 | Major. **6.4.5** is the latest 6.x. No 6.x advisory required a Vite 7/8 migration. |
| React / react-dom | 19.3.1 | Major. Panel stays on 18.3.1. |
| i18next | 26.5.10 | Major. Stays on 24.2.3; `react-i18next` stays on 15.7.4. |
| @simplewebauthn/server and browser | 14.0.3 / 14.0.0 | Major. Server stays **13.3.3**; browser stays **13.3.0** (latest 13.x). `install.sh` still repairs `@simplewebauthn/server@13.3.3`. |
| webtorrent (apps/web) | 3.0.21 | 2 → 3 is the breaking jump called out for the panel. Panel stays **2.8.5**. Core is already on 3.0.21. |
| pnpm | 12.15.0 | pnpm 12 is a breaking major. pnpm 10/11 would rewrite the lockfile and the `packageManager` pin. Stays **9.15.9**. |
| Vitest 5 | 5.0.5 | 4.1.12 already stays on the 4.x line that cleared the Vitest advisories. Vitest 5 is a further major and was not required. |
| pm2 | 7.1.1 | Installer pins 6.0.14 so a fresh host does not take an untested major. |

Also not bumped (majors or line jumps): `@types/node` 22 → 26, `@vitejs/plugin-react` 4 → 6, `react-i18next` 15 → 17.

## Installer and Actions

`install.sh` still fetches installer libraries over HTTPS and, when present, checks `install/checksums.sha256`. Node.js still comes from NodeSource `setup_24.x`. That pipe is the remaining installer trust boundary. Pins are unchanged: `pnpm@9.15.9`, `node-gyp-build@4.8.4`, `pm2@6.0.14`.

Actions stay on the v4 line. The pin is the v4.4.0 commit, not the moving `v4` tag. Latest v4 remains checkout / setup-node / pnpm/action-setup **v4.4.0**. Release workflow npm CLI is **11.21.1** (still 11.x, not npm 12).

## Re-check

```bash
pnpm audit
```

Expected: one high advisory, `ip` ≤2.0.1, GHSA-2p57-rm9w-gvfp. No critical. No moderate. `happy-dom` and `source-map-js` are gone from the report.

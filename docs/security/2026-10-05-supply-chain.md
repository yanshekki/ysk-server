# Supply-chain review — 2026-10-05

> Language: English | [中文](./2026-10-05-supply-chain-ZH.md)

Review for YSK Server **1.1.27**. `pnpm audit` after the lockfile update reports **one** remaining advisory (`ip`). Everything else from the 1.1.26 pre-scan is fixed or no longer present.

## Scope

Published packages `ysk-server`, `ysk-server-shared`, and `ysk-server-core`, the private panel `apps/web`, the pnpm 9.15.9 lockfile, GitHub Actions, and `install.sh` (npm globals, asset checksums, NodeSource).

## Method

`pnpm audit` (direct and transitive), lockfile inspection, and a read of runtime imports. Native addons were installed in this environment (`node-pty` rebuilt; `bufferutil` and `utf-8-validate` ran `node-gyp-build`). No package name in the tree is a known typosquat of a direct dependency.

## Results

### Fixed

| Component | Severity | Advisory | Status |
|-----------|----------|----------|--------|
| vitest (dev) | Critical | GHSA-5xrq-8626-4rwp | Fixed in **4.1.11** (also covers 3.2.6 / 4.1.0). Dev server only; CI runs `vitest run`, not the UI on a public host. |
| @vitest/mocker (dev) | Moderate | GHSA-82fw-gwwq-j7x9 | Fixed in **4.1.11**. 2.x and 3.x are unmaintained, so the jump is 2.1.8 → 4.1.11. |
| vite (dev) | High | GHSA-fx2h-pf6j-xcff | Fixed in **6.4.3**. Vite 7 and 8 were not required. |
| vite / launch-editor / esbuild (dev) | Moderate | esbuild ≤0.24.2 and the Vite path / launch-editor notes in the pre-scan | Cleared with Vite 6.4.3. Resolved esbuild is **0.25.12** and **0.28.1**. `pnpm audit` is clean for both. |
| brace-expansion | High | GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p | Not in the resolved tree after the upgrade. Overrides remain: 1.1.21, 2.1.7, 3.0.9, and 4.x → 5.0.12. |
| nanoid | High | GHSA-2v37-7h3g-55p8 | Fixed. Resolved **3.3.19** (patched line is ≥3.3.18). Override also forces 4.x/5.x below 5.1.6 up to **5.1.16**. |
| ip-address | Moderate | four advisories on 10.5.0 via socks / ip-set | Fixed. Override `ip-address@<10.7.1` → **10.7.3**. |
| ws | — | maintenance | **8.22.0** (direct). Optional natives `bufferutil` and `utf-8-validate` build with `node-gyp-build`. |
| GitHub Actions | — | floating tags | Pinned to commit SHAs: checkout `11d5960` (v4.4.0), setup-node `49933ea` (v4.4.0), pnpm/action-setup `fc06bc1` (v4.4.0). |
| install.sh pnpm | — | `pnpm@latest` when major &lt; 11 | Pinned to **pnpm@9.15.9** (same as `packageManager`). Existing pnpm 11.x is left in place. pnpm 12 is not installed. |
| install.sh node-gyp-build | — | `npm install -g --force` unpinned | Pinned to **node-gyp-build@4.8.4** without `--force`. |
| install.sh pm2 | — | `pm2@latest` | When pm2 is missing, install **pm2@6.0.14**. pm2 7 is not pulled. |

### Unfixed

| Component | Severity | Advisory | Status |
|-----------|----------|----------|--------|
| ip 2.0.1 | High | GHSA-2p57-rm9w-gvfp | **Unfixed upstream** (no patched release). Runtime via `bittorrent-tracker@11.2.3` (core WebTorrent 3 and panel WebTorrent 2.8.5). |
| NodeSource setup | — | `curl \| bash` of `setup_24.x` | **Accepted.** The script is unpinned. Replacing it would change how Node 24 is installed on Ubuntu. |
| Asset checksums | — | optional unless `YSK_INSTALL_REQUIRE_CHECKSUMS=1` | **Mitigated, not mandatory.** When `install/checksums.sha256` is reachable it is verified. A missing file still warns and continues, so a one-liner against a base without the file does not fail closed. |
| pnpm 10 / 11 / 12 | — | major package-manager upgrades | **Deferred.** See below. The lockfile stays pnpm 9. |

`ip` exposure: `bittorrent-tracker` calls `ip.toString()` once, in `lib/server/parse-udp.js`, to turn the optional 32-bit address in a UDP announce into a dotted string. It does **not** call `isPublic`, `isPrivate`, or `isLoopback`. Those classifiers are what GHSA-2p57-rm9w-gvfp gets wrong, and they are the SSRF footgun. Peer addresses here are tracker swarm data, not a guard before an outbound request. Panel DDNS uses `isPublicIpv4` / `isPublicIpv6` in `packages/core` (own code, not the `ip` package). No override was applied: there is no patched `ip@2.0.2`, and swapping in an unreviewed fork would be a new supply-chain dependency. Revisit when `bittorrent-tracker` drops `ip`.

## Deferred upgrades

| Package | Latest seen | Why it stays |
|---------|-------------|--------------|
| TypeScript | 7.0.2 | Major. This release moves 5.7.2 → **5.9.3** only. |
| Vite | 8.3.2 | Major. **6.4.3** clears GHSA-fx2h-pf6j-xcff without a Vite 7/8 migration. |
| React / react-dom | 19.3.0 | Major. Panel stays on 18.3.1. |
| i18next | 26.4.2 | Major. Stays on 24.2.3; `react-i18next` stays on 15.7.4. |
| @simplewebauthn/server and browser | 14.0.3 | Major. Server moves 13.3.2 → **13.3.3** only. `install.sh` repairs `@simplewebauthn/server@13.3.3`. |
| webtorrent (apps/web) | 3.0.21 | 2 → 3 is the breaking jump called out for the panel. Panel moves 2.5.1 → **2.8.5** (still 2.x). Core is already on 3.0.21. |
| pnpm | 12.9.1 | pnpm 12 is a breaking major. pnpm 10/11 would rewrite the lockfile and the `packageManager` pin. This release moves 9.15.0 → **9.15.9** only. |
| Vitest 5 | 5.0.3 | 4.1.11 already clears both Vitest advisories. Vitest 5 is a further major and was not required. |
| pm2 | 7.0.4 | Installer pins 6.0.14 so a fresh host does not take an untested major. |

## Installer and Actions

`install.sh` still fetches installer libraries over HTTPS and, when present, checks `install/checksums.sha256` (updated for the `stack-ops.sh` comment change). Node.js still comes from NodeSource `setup_24.x`. That pipe is the remaining installer trust boundary.

Actions stay on the v4 line. The pin is the v4.4.0 commit, not the moving `v4` tag.

## Re-check

```bash
pnpm audit
```

Expected: one high advisory, `ip` ≤2.0.1, GHSA-2p57-rm9w-gvfp. No critical. No moderate.

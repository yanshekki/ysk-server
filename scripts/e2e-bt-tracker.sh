#!/usr/bin/env bash
# Lightweight BT tracker + torrent smoke (no multi-host peers required).
# Usage: bash scripts/e2e-bt-tracker.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CLI="${CLI:-node apps/server/dist/cli.js}"
if [[ ! -f apps/server/dist/cli.js ]]; then
  echo "Building server…"
  pnpm --filter @ysk-server/shared build
  pnpm --filter @ysk-server/core build
  pnpm --filter ysk-server build
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/ysk-bt-e2e.XXXXXX")"
export YSK_EXECUTE=1
PORT=$((18000 + RANDOM % 1000))
export TMP PORT

cleanup() {
  YSK_EXECUTE=1 $CLI bt-tracker stop --data-dir "$TMP" --json >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "==> dataDir=$TMP port=$PORT"

$CLI bt-tracker settings set --http-port "$PORT" --public-host "127.0.0.1" --data-dir "$TMP" --json >/dev/null
START_OUT="$($CLI bt-tracker start --execute --data-dir "$TMP" --json)"
echo "$START_OUT" | head -c 300
echo
sleep 0.7
STATUS="$($CLI bt-tracker status --data-dir "$TMP" --json)"
echo "$STATUS" | head -c 400
echo
echo "$STATUS" | grep -q '"running": true' || {
  echo "FAIL: tracker not running"
  echo "$STATUS"
  exit 1
}

node --input-type=module <<'JS'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createShareTorrent } from './packages/core/dist/hosting/bt-tracker/torrent-create.js';
import { DEFAULT_BT_TRACKER_SETTINGS } from './packages/shared/dist/bt-tracker.js';
import { listBtTrackerTorrents } from './packages/core/dist/hosting/bt-tracker/service.js';
import { scrapeUrlFromAnnounce, encodeInfoHashQuery } from './packages/core/dist/hosting/bt-tracker/scrape.js';

const dataDir = process.env.TMP;
const port = Number(process.env.PORT);
const content = join(dataDir, 'files', 'public', 'smoke.bin');
mkdirSync(join(dataDir, 'files', 'public'), { recursive: true });
writeFileSync(content, Buffer.alloc(32 * 1024, 9));

const r = await createShareTorrent({
  dataDir,
  contentAbsPath: content,
  shareId: 'e2e1',
  settings: {
    ...DEFAULT_BT_TRACKER_SETTINGS,
    httpPort: port,
    publicAnnounceHost: '127.0.0.1',
  },
  name: 'smoke.bin',
});
if (!r.ok || !r.infoHash) {
  console.error('FAIL create torrent', r);
  process.exit(1);
}
console.log('torrent ok', r.infoHash.slice(0, 12), 'piece', r.pieceLength);

const rows = listBtTrackerTorrents({
  hints: [{ infoHash: r.infoHash, name: 'smoke.bin', seeders: 1 }],
});
if (!rows.some((x) => x.infoHash === r.infoHash)) {
  console.error('FAIL list torrents', rows);
  process.exit(1);
}
console.log('list torrents ok', rows.length);

if (!r.torrentAbsPath || !existsSync(r.torrentAbsPath)) {
  console.error('FAIL missing torrent file');
  process.exit(1);
}

const scrapeUrl = scrapeUrlFromAnnounce(
  `http://127.0.0.1:${port}/announce`,
  [r.infoHash],
);
if (!scrapeUrl || !encodeInfoHashQuery(r.infoHash)) {
  console.error('FAIL scrape URL helpers');
  process.exit(1);
}
console.log('scrape helpers ok');

// multi-file folder torrent
const tree = join(dataDir, 'files', 'public', 'tree');
mkdirSync(join(tree, 'nested'), { recursive: true });
writeFileSync(join(tree, 'a.txt'), 'aaa');
writeFileSync(join(tree, 'nested', 'b.txt'), 'bbbbbbbb');
const dirTor = await createShareTorrent({
  dataDir,
  contentAbsPath: tree,
  shareId: 'e2e-dir',
  settings: {
    ...DEFAULT_BT_TRACKER_SETTINGS,
    httpPort: port,
    publicAnnounceHost: '127.0.0.1',
  },
  name: 'tree',
});
if (!dirTor.ok || !dirTor.infoHash) {
  console.error('FAIL dir torrent', dirTor);
  process.exit(1);
}
console.log('dir torrent ok', dirTor.infoHash.slice(0, 12));

// job queue threshold helper
import {
  shouldCreateTorrentAsync,
  BT_TORRENT_SYNC_MAX_BYTES,
} from './packages/core/dist/hosting/bt-tracker/torrent-jobs.js';
const gate = shouldCreateTorrentAsync(content);
if (gate.async !== gate.estimatedBytes >= BT_TORRENT_SYNC_MAX_BYTES) {
  console.error('FAIL size gate', gate);
  process.exit(1);
}
console.log('size gate ok estimated=', gate.estimatedBytes, 'async=', gate.async);

// hit local tracker HTTP (detached worker)
try {
  const res = await fetch(`http://127.0.0.1:${port}/stats.json`);
  if (res.ok) {
    const j = await res.json();
    console.log('stats.json ok torrents=', j.torrents);
  } else {
    console.log('stats.json status', res.status, '(non-fatal)');
  }
} catch (e) {
  console.log('stats.json fetch skipped', e instanceof Error ? e.message : e);
}

console.log('e2e-bt-tracker OK');
JS

echo "==> all smoke checks passed"
exit 0

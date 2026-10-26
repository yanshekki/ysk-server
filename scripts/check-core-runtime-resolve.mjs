#!/usr/bin/env node
/**
 * After pnpm install + build: every ysk-server-core runtime dep must resolve
 * from core's compiled lookup.js (workspace layout used by --from-source).
 *
 * If apps/server/node_modules/ysk-server-core is a real directory (bundled /
 * overlay copy) rather than a workspace symlink, those same deps must also
 * resolve from that copy — the published product flattens them onto ysk-server.
 */
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coreRuntimeDepNames,
  flattenedProductDependencies,
} from './lib/product-dependencies.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corePkg = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8'));
const serverPkg = JSON.parse(readFileSync(join(root, 'apps/server/package.json'), 'utf8'));
const names = coreRuntimeDepNames(corePkg);
const lookup = join(root, 'packages/core/dist/hosting/defense/geoip/lookup.js');

if (!existsSync(lookup)) {
  console.error('check-core-runtime-resolve: build packages/core first (missing dist lookup.js)');
  process.exit(1);
}

const flat = flattenedProductDependencies(serverPkg, corePkg);
const missingFromProduct = names.filter((n) => !flat[n]);
if (missingFromProduct.length) {
  console.error(
    'check-core-runtime-resolve: product flatten dropped core runtime deps:',
    missingFromProduct.join(', '),
  );
  process.exit(1);
}

/** Walk node_modules like Node package resolution (package.json present). */
function resolvePackageJson(name, parentFile) {
  let dir = dirname(parentFile);
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

function assertResolves(name, parentFile) {
  const found = resolvePackageJson(name, parentFile);
  if (!found) {
    throw new Error(`Cannot resolve '${name}' from ${parentFile}`);
  }
}

for (const name of names) {
  assertResolves(name, lookup);
}

const bundledRoot = join(root, 'apps/server/node_modules/ysk-server-core');
const bundledLookup = join(bundledRoot, 'dist/hosting/defense/geoip/lookup.js');
if (existsSync(bundledRoot) && existsSync(bundledLookup)) {
  const st = lstatSync(bundledRoot);
  if (!st.isSymbolicLink()) {
    for (const name of names) {
      assertResolves(name, bundledLookup);
    }
  }
}

console.log(`core runtime resolve OK (${names.length} deps, flatten=${Object.keys(flat).length})`);

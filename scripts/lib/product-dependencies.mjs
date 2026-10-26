/**
 * Product package.json for npm publish.
 *
 * ysk-server bundleDependencies ships ysk-server-core and ysk-server-shared
 * inside the tarball (workspace packages). Node then resolves imports from
 * node_modules/ysk-server-core/dist/... by walking up to the product
 * node_modules — so every ysk-server-core runtime dep must also be a
 * direct dependency of ysk-server (flatten). Overlay copies the bundled
 * workspace packages, then npm install --omit=dev fills the rest.
 */
export const BUNDLED_WORKSPACE_PACKAGES = ['ysk-server-shared', 'ysk-server-core'];

export function coreRuntimeDepNames(corePkg) {
  return Object.keys(corePkg?.dependencies || {}).filter(
    (k) => !BUNDLED_WORKSPACE_PACKAGES.includes(k),
  );
}

export function flattenedProductDependencies(serverPkg, corePkg, versions = {}) {
  const deps = {};
  for (const src of [corePkg?.dependencies || {}, serverPkg?.dependencies || {}]) {
    for (const [k, v] of Object.entries(src)) {
      if (BUNDLED_WORKSPACE_PACKAGES.includes(k)) continue;
      if (typeof v === 'string' && v.startsWith('workspace:')) continue;
      deps[k] = v;
    }
  }
  if (versions.shared) deps['ysk-server-shared'] = versions.shared;
  if (versions.core) deps['ysk-server-core'] = versions.core;
  return deps;
}

export function stagedYskServerPackage(serverPkg, corePkg, versions = {}) {
  return {
    name: 'ysk-server',
    version: serverPkg.version,
    description: serverPkg.description,
    type: 'module',
    bin: serverPkg.bin,
    main: serverPkg.main,
    types: serverPkg.types,
    files: ['dist', 'public', 'README.md'],
    engines: serverPkg.engines,
    repository: serverPkg.repository,
    license: serverPkg.license || 'MIT',
    keywords: serverPkg.keywords,
    homepage: 'https://github.com/yanshekki/ysk-server#readme',
    bugs: { url: 'https://github.com/yanshekki/ysk-server/issues' },
    publishConfig: { access: 'public' },
    dependencies: flattenedProductDependencies(serverPkg, corePkg, versions),
    bundleDependencies: [...BUNDLED_WORKSPACE_PACKAGES],
  };
}

/**
 * Multi-version hosting runtime selection contracts.
 * Process apps: node | python | go | rust | java | kotlin | bun
 * PHP-FPM: php · Static files: static
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, tl } from '@ysk/shared';

export type RuntimeKind = 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun';

export type ProjectRuntimeKind =
  | 'node'
  | 'php'
  | 'static'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'kotlin'
  | 'bun';

export type RuntimeManager =
  | 'nvm'
  | 'fnm'
  | 'nodesource'
  | 'sury-php'
  | 'ondrej-php' // legacy alias — install uses packages.sury.org/php
  | 'deadsnakes'
  | 'go-official'
  | 'rustup'
  | 'openjdk-apt'
  | 'kotlin-official'
  | 'bun-official'
  | 'system';

export interface RuntimeSelection {
  kind: RuntimeKind;
  version: string;
  /** Absolute path hint for binary on target host */
  binaryPath: string;
  manager: RuntimeManager;
}

/**
 * @deprecated NOT a source of truth for installable versions.
 * Installable pins come from version-discovery (upstream APIs).
 * Kept only so older tests/imports compile; values are empty.
 */
export const NODE_SUPPORTED: readonly string[] = [];
export const PHP_SUPPORTED: readonly string[] = [];
export const PYTHON_SUPPORTED: readonly string[] = [];
export const GO_SUPPORTED: readonly string[] = [];
/** @deprecated removed — use go.dev live list via pickLatestGoDownloadVersion(available) */
export const GO_LAST_KNOWN_PATCH: Record<string, string> = {};
export const RUST_SUPPORTED: readonly string[] = [];
export const JAVA_SUPPORTED: readonly string[] = [];
export const KOTLIN_SUPPORTED: readonly string[] = [];
export const BUN_SUPPORTED: readonly string[] = [];

const PROCESS_RUNTIMES = new Set(['node', 'python', 'go', 'rust', 'java', 'kotlin', 'bun']);

export function isProcessRuntime(runtime: string): boolean {
  return PROCESS_RUNTIMES.has(runtime);
}

export function isHostingRuntime(value: string): value is ProjectRuntimeKind {
  return (
    value === 'node' ||
    value === 'php' ||
    value === 'static' ||
    value === 'python' ||
    value === 'go' ||
    value === 'rust' ||
    value === 'java' ||
    value === 'kotlin' ||
    value === 'bun'
  );
}

/** Default version string per runtime when client omits runtimeVersion. */
export function defaultRuntimeVersion(runtime: ProjectRuntimeKind | string): string {
  if (runtime === 'php') return '8.2';
  if (runtime === 'node') return '20';
  if (runtime === 'python') return '3.12';
  if (runtime === 'go') return '1.22';
  if (runtime === 'rust') return 'stable';
  if (runtime === 'java') return '21';
  if (runtime === 'kotlin') return '2.1.0';
  if (runtime === 'bun') return 'latest';
  return '';
}

/**
 * Normalize / repair stored runtimeVersion.
 * Accepts any shape-valid version from discovery — does NOT clamp to a hardcoded list.
 * Fixes historical bug: PHP projects incorrectly defaulted to Node "20".
 */
export function normalizeRuntimeVersion(
  runtime: ProjectRuntimeKind | string,
  version?: string | null,
): string {
  const raw = (version ?? '').trim();
  if (runtime === 'static') return '';

  if (runtime === 'php') {
    // Node majors wrongly stored as PHP
    if (!raw || raw === '18' || raw === '20' || raw === '22') {
      return defaultRuntimeVersion('php');
    }
    const normalized = raw.startsWith('php') ? raw.slice(3).replace(/^\s+/, '') : raw;
    if (/^\d+$/.test(normalized) && !normalized.includes('.')) {
      return defaultRuntimeVersion('php');
    }
    const minor = normalized.match(/^(\d+\.\d+)/)?.[1];
    return minor ?? defaultRuntimeVersion('php');
  }

  if (runtime === 'node') {
    if (!raw) return defaultRuntimeVersion('node');
    const major = raw.replace(/^v/, '').split('.')[0];
    return /^\d+$/.test(major) ? major : defaultRuntimeVersion('node');
  }

  if (runtime === 'python') {
    if (!raw) return defaultRuntimeVersion('python');
    const m = raw.replace(/^python/, '').trim();
    const minor = m.match(/^(\d+\.\d+)/)?.[1];
    return minor ?? defaultRuntimeVersion('python');
  }

  if (runtime === 'go') {
    if (!raw) return defaultRuntimeVersion('go');
    const m = raw.replace(/^go/, '').trim();
    const full = m.match(/^(\d+\.\d+\.\d+)/)?.[1];
    if (full) return full;
    const minor = m.match(/^(\d+\.\d+)/)?.[1];
    return minor ?? defaultRuntimeVersion('go');
  }

  if (runtime === 'rust') {
    if (!raw) return defaultRuntimeVersion('rust');
    if (raw === 'stable' || raw === 'nightly' || raw === 'beta') return raw;
    const minor = raw.match(/^(\d+\.\d+(\.\d+)?)/)?.[1];
    return minor ?? defaultRuntimeVersion('rust');
  }

  if (runtime === 'java') {
    if (!raw) return defaultRuntimeVersion('java');
    const major = raw.replace(/^jdk-?|^java-?/i, '').split('.')[0];
    return /^\d+$/.test(major) ? major : defaultRuntimeVersion('java');
  }

  if (runtime === 'kotlin') {
    if (!raw || raw === 'stable' || raw === 'latest') return defaultRuntimeVersion('kotlin');
    const v = raw.replace(/^v/i, '');
    return /^\d+\.\d+/.test(v) ? v : defaultRuntimeVersion('kotlin');
  }

  if (runtime === 'bun') {
    if (!raw) return defaultRuntimeVersion('bun');
    if (raw === 'latest') return 'latest';
    return /^\d+\.\d+/.test(raw) ? raw : defaultRuntimeVersion('bun');
  }

  return raw;
}

/**
 * Shape-only validation — versions come from version-discovery / user choice,
 * NOT a hardcoded allow-list of release numbers.
 */
function assertVersionShape(kind: RuntimeKind, version: string, ok: boolean): void {
  if (ok) return;
  throw new YskError(
    ErrorCodes.VALIDATION,
    tl('notes.auto.t0254', {
      v0: version,
      v1: `${kind}: invalid version shape (discover via software/versions API)`,
    }),
    { httpStatus: 400 },
  );
}

export function selectNodeRuntime(version: string): RuntimeSelection {
  const major = version.replace(/^v/, '').split('.')[0];
  assertVersionShape('node', version, /^\d+$/.test(major) && Number(major) >= 12);
  return {
    kind: 'node',
    version: major,
    binaryPath: `/usr/local/ysk/node/${major}/bin/node`,
    manager: 'fnm',
  };
}

export function selectPhpRuntime(version: string): RuntimeSelection {
  const normalized = (version.startsWith('php') ? version.slice(3) : version).trim();
  const minor = normalized.match(/^(\d+\.\d+)/)?.[1] ?? normalized;
  assertVersionShape('php', version, /^\d+\.\d+$/.test(minor));
  return {
    kind: 'php',
    version: minor,
    binaryPath: `/usr/bin/php${minor}`,
    manager: 'sury-php',
  };
}

export function selectPythonRuntime(version: string): RuntimeSelection {
  const raw = (version ?? '').replace(/^python/, '').trim();
  const minor = raw.match(/^(\d+\.\d+)/)?.[1] ?? raw;
  assertVersionShape('python', version, /^\d+\.\d+$/.test(minor));
  return {
    kind: 'python',
    version: minor,
    binaryPath: `/usr/bin/python${minor}`,
    manager: 'deadsnakes',
  };
}

export function selectGoRuntime(version: string): RuntimeSelection {
  const raw = (version ?? '').replace(/^go/, '').trim();
  // Accept full patch (1.26.5) or minor (1.26). Panel + managed path SSOT is always minor.
  const minor = raw.match(/^(\d+\.\d+)/)?.[1] ?? raw;
  assertVersionShape('go', version, /^\d+\.\d+(\.\d+)?$/.test(raw));
  return {
    kind: 'go',
    version: minor,
    binaryPath: `/usr/local/ysk/go/${minor}/bin/go`,
    manager: 'go-official',
  };
}

/**
 * go.dev/dl only ships full patch tarballs (go1.21.13.linux-amd64.tar.gz).
 * Resolve minor "1.21" to newest matching patch from **live** go.dev version list.
 * When `available` is empty, returns full version if already x.y.z, else minor+".0"
 * (caller should re-fetch go.dev — no hardcoded patch table).
 */
export function pickLatestGoDownloadVersion(
  panelVersion: string,
  available: string[],
): string {
  const raw = panelVersion.replace(/^go/i, '').trim();
  // Already full x.y.z
  if (/^\d+\.\d+\.\d+$/.test(raw)) return raw;
  const minor = raw.match(/^(\d+\.\d+)/)?.[1] ?? raw;
  const patches: string[] = [];
  for (const entry of available) {
    const v = String(entry).replace(/^go/i, '').trim();
    if (v === minor) {
      patches.push(`${minor}.0`);
      continue;
    }
    if (v.startsWith(`${minor}.`) && /^\d+\.\d+\.\d+/.test(v)) {
      const full = v.match(/^(\d+\.\d+\.\d+)/)?.[1];
      if (full) patches.push(full);
    }
  }
  if (patches.length === 0) {
    // No hardcoded fallback table — prefer explicit full version from discovery
    return /^\d+\.\d+\.\d+$/.test(raw) ? raw : `${minor}.0`;
  }
  const rank = (s: string) => s.split('.').map((n) => parseInt(n, 10) || 0);
  patches.sort((a, b) => {
    const aa = rank(a);
    const bb = rank(b);
    for (let i = 0; i < 3; i++) {
      const d = (aa[i] ?? 0) - (bb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  return patches[patches.length - 1]!;
}

/**
 * @deprecated No hardcoded patch map — kept empty for older install scripts.
 * Prefer live go.dev list in runtime-probe.
 */
export function goLastKnownPatchShellCase(): string {
  return '    *) echo "" ;;';
}

export function selectRustRuntime(version: string): RuntimeSelection {
  const raw = (version ?? '').trim() || 'stable';
  const ok =
    raw === 'stable' ||
    raw === 'beta' ||
    raw === 'nightly' ||
    /^\d+\.\d+(\.\d+)?$/.test(raw);
  assertVersionShape('rust', version, ok);
  return {
    kind: 'rust',
    version: raw,
    binaryPath: '/usr/local/ysk/rust/cargo/bin/cargo',
    manager: 'rustup',
  };
}

export function selectJavaRuntime(version: string): RuntimeSelection {
  const major = (version ?? '').replace(/^jdk-?/i, '').split('.')[0];
  assertVersionShape('java', version, /^\d+$/.test(major) && Number(major) >= 8);
  return {
    kind: 'java',
    version: major,
    binaryPath: `/usr/lib/jvm/java-${major}-openjdk-amd64/bin/java`,
    manager: 'openjdk-apt',
  };
}

export function selectKotlinRuntime(version: string): RuntimeSelection {
  const v = (version ?? '').replace(/^v/i, '').trim();
  assertVersionShape('kotlin', version, /^\d+\.\d+(\.\d+)?$/.test(v));
  return {
    kind: 'kotlin',
    version: v,
    binaryPath: `/usr/local/ysk/kotlin/bin/kotlinc`,
    manager: 'kotlin-official',
  };
}

export function selectBunRuntime(version: string): RuntimeSelection {
  const raw = (version ?? '').trim() || 'latest';
  const ok = raw === 'latest' || /^\d+\.\d+/.test(raw);
  assertVersionShape('bun', version, ok);
  return {
    kind: 'bun',
    version: raw,
    binaryPath: '/usr/local/ysk/bun/bin/bun',
    manager: 'bun-official',
  };
}

export function selectRuntime(kind: RuntimeKind, version: string): RuntimeSelection {
  if (kind === 'node') return selectNodeRuntime(version);
  if (kind === 'php') return selectPhpRuntime(version);
  if (kind === 'python') return selectPythonRuntime(version);
  if (kind === 'go') return selectGoRuntime(version);
  if (kind === 'rust') return selectRustRuntime(version);
  if (kind === 'java') return selectJavaRuntime(version);
  if (kind === 'kotlin') return selectKotlinRuntime(version);
  if (kind === 'bun') return selectBunRuntime(version);
  throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0258', { v0: (kind) }), { httpStatus: 400 });
}

/**
 * Generate PM2 / systemd unit skeleton for a Node project.
 */
export function renderNodeProcessUnit(opts: {
  projectName: string;
  linuxUser: string;
  appDir: string;
  nodeBinary: string;
  entry: string;
  port: number;
  memoryMax?: string;
  cpuQuotaPercent?: number;
  limitNOFILE?: number;
  /** Extra env (e.g. panel runtime tuning → NODE_OPTIONS) */
  env?: Record<string, string>;
}): string {
  return renderProcessUnit({
    projectName: opts.projectName,
    linuxUser: opts.linuxUser,
    appDir: opts.appDir,
    execStart: `${opts.nodeBinary} ${opts.entry}`,
    port: opts.port,
    env: {
      NODE_ENV: 'production',
      PORT: String(opts.port),
      ...(opts.env ?? {}),
    },
    memoryMax: opts.memoryMax,
    cpuQuotaPercent: opts.cpuQuotaPercent,
    limitNOFILE: opts.limitNOFILE,
  });
}

/** Generic process unit for node/python/go/rust — runs as project Linux user. */
export function renderProcessUnit(opts: {
  projectName: string;
  linuxUser: string;
  appDir: string;
  /** Project home for ReadWritePaths (defaults to parent of appDir) */
  homeDir?: string;
  execStart: string;
  port: number;
  env?: Record<string, string>;
  memoryMax?: string;
  cpuQuotaPercent?: number;
  limitNOFILE?: number;
  tasksMax?: number;
  /** Harden unit (default true) */
  harden?: boolean;
}): string {
  const limits: string[] = [];
  if (opts.memoryMax) {
    limits.push(`MemoryMax=${opts.memoryMax}`);
    limits.push(`MemoryHigh=${opts.memoryMax}`);
  }
  if (opts.cpuQuotaPercent != null && opts.cpuQuotaPercent > 0) {
    limits.push(`CPUQuota=${Math.min(10000, Math.floor(opts.cpuQuotaPercent))}%`);
  }
  if (opts.limitNOFILE != null && opts.limitNOFILE > 0) {
    limits.push(`LimitNOFILE=${opts.limitNOFILE}`);
  }
  if (opts.tasksMax != null && opts.tasksMax > 0) {
    limits.push(`TasksMax=${Math.floor(opts.tasksMax)}`);
  }
  const home =
    opts.homeDir ??
    (opts.appDir.endsWith('/app') ? opts.appDir.slice(0, -4) : opts.appDir);
  const harden = opts.harden !== false;
  const hardenLines = harden
    ? [
        'NoNewPrivileges=yes',
        'PrivateTmp=yes',
        'ProtectSystem=strict',
        // WorkingDirectory is under home; allow RW only there
        `ReadWritePaths=${home}`,
        // ProtectHome would block /home — we pin RW paths instead
        'ProtectKernelTunables=yes',
        'ProtectControlGroups=yes',
        'RestrictSUIDSGID=yes',
      ].join('\n') + '\n'
    : '';
  const limitBlock = limits.length ? limits.join('\n') + '\n' : '';
  const envLines = Object.entries({
    PORT: String(opts.port),
    ...opts.env,
  })
    .map(([k, v]) => `Environment=${k}=${v}`)
    .join('\n');
  return `[Unit]
Description=YSK Server project ${opts.projectName}
After=network.target

[Service]
Type=simple
User=${opts.linuxUser}
Group=${opts.linuxUser}
WorkingDirectory=${opts.appDir}
${envLines}
ExecStart=${opts.execStart}
Restart=on-failure
RestartSec=5
${hardenLines}${limitBlock}
[Install]
WantedBy=multi-user.target
`;
}

/**
 * Default ExecStart / build hints per process runtime.
 */
export function defaultProcessCommands(
  runtime: ProjectRuntimeKind | string,
  opts: { version?: string; entry?: string; port?: number; cargoName?: string },
): { build?: string; execStart: string; entry: string } {
  if (runtime === 'python') {
    // Django WSGI: "mysite.wsgi:application" → gunicorn
    // FastAPI/ASGI: "main:app" → uvicorn
    // Plain script: app.py / main.py
    const entry = opts.entry ?? 'main:app';
    // Honest: if requirements.txt exists it must install; missing file is skip
    const pyBuild =
      'python3 -m venv venv && ./venv/bin/pip install -U pip && if [ -f requirements.txt ]; then ./venv/bin/pip install -r requirements.txt; else echo "no requirements.txt — skip deps"; fi';
    const isWsgi =
      /\.wsgi:application$/.test(entry) ||
      entry.endsWith('.wsgi:app') ||
      entry.startsWith('gunicorn:');
    const wsgiTarget = entry.startsWith('gunicorn:') ? entry.slice('gunicorn:'.length) : entry;
    if (isWsgi) {
      return {
        build: pyBuild,
        execStart: `/bin/bash -lc 'cd "$PWD" && if [ -x venv/bin/gunicorn ]; then exec venv/bin/gunicorn ${wsgiTarget} --bind 127.0.0.1:"\${PORT:-3000}" --workers 2; elif [ -x venv/bin/python ]; then exec venv/bin/python -m gunicorn ${wsgiTarget} --bind 127.0.0.1:"\${PORT:-3000}"; else exec python3 -m gunicorn ${wsgiTarget} --bind 127.0.0.1:"\${PORT:-3000}"; fi'`,
        entry: wsgiTarget,
      };
    }
    const isAsgi = entry.includes(':') && !entry.endsWith('.py');
    if (isAsgi) {
      return {
        build: pyBuild,
        execStart: `/bin/bash -lc 'cd "$PWD" && if [ -x venv/bin/uvicorn ]; then exec venv/bin/uvicorn ${entry} --host 127.0.0.1 --port "\${PORT:-3000}"; elif [ -x venv/bin/python ]; then exec venv/bin/python -m uvicorn ${entry} --host 127.0.0.1 --port "\${PORT:-3000}"; else exec python3 -m uvicorn ${entry} --host 127.0.0.1 --port "\${PORT:-3000}"; fi'`,
        entry,
      };
    }
    return {
      build: pyBuild,
      execStart: `/bin/bash -lc 'cd "$PWD" && if [ -x venv/bin/python ]; then exec venv/bin/python ${entry}; else exec python3 ${entry}; fi'`,
      entry,
    };
  }
  if (runtime === 'go') {
    const entry = opts.entry ?? './app';
    return {
      build: 'go build -o app .',
      execStart: entry.startsWith('./') || entry.startsWith('/') ? entry : `./${entry}`,
      entry,
    };
  }
  if (runtime === 'rust') {
    const bin = opts.cargoName ?? 'app';
    const entry = opts.entry ?? `./target/release/${bin}`;
    return {
      build: 'cargo build --release',
      execStart: entry,
      entry,
    };
  }
  if (runtime === 'java' || runtime === 'kotlin') {
    // JVM apps: prefer fat jar; build via Maven wrapper / Gradle when present
    const entry = opts.entry ?? 'app.jar';
    const build =
      'if [ -x ./mvnw ]; then ./mvnw -q -DskipTests package; ' +
      'elif [ -x ./gradlew ]; then ./gradlew -q bootJar || ./gradlew -q jar; ' +
      'elif [ -f pom.xml ]; then mvn -q -DskipTests package; ' +
      'elif [ -f build.gradle ] || [ -f build.gradle.kts ]; then gradle -q bootJar || gradle -q jar; ' +
      'else echo "no Maven/Gradle build — using existing jar"; fi';
    const jar = entry.startsWith('./') || entry.startsWith('/') ? entry : `./${entry}`;
    return {
      build,
      // Spring Boot honors SERVER_PORT; others often use PORT
      execStart: `/bin/bash -lc 'export SERVER_PORT="\${PORT:-3000}"; exec java -jar ${jar}'`,
      entry: jar,
    };
  }
  if (runtime === 'bun') {
    const entry = opts.entry ?? 'index.ts';
    return {
      build: 'if [ -f package.json ]; then bun install; else echo "no package.json — skip bun install"; fi',
      execStart: `/bin/bash -lc 'if [ -f package.json ] && bun run --silent start >/dev/null 2>&1; then exec bun run start; else exec bun ${entry}; fi'`,
      entry,
    };
  }
  // node (default process fallback only for kind=node)
  const entry = opts.entry ?? 'server.js';
  return {
    execStart: `node ${entry}`,
    entry,
  };
}

/** Detect a reasonable jar path under appDir (Maven/Gradle layouts). */
export function detectJavaEntry(appDir: string): string | undefined {
  const candidates = [
    'app.jar',
    'application.jar',
    join('target', 'app.jar'),
    join('build', 'libs'),
    'target',
  ];
  for (const rel of candidates) {
    const abs = join(appDir, rel);
    try {
      if (!existsSync(abs)) continue;
      const st = statSync(abs);
      if (st.isFile() && abs.endsWith('.jar')) return `./${rel}`;
      if (st.isDirectory()) {
        const jars = readdirSync(abs)
          .filter(
            (n) =>
              n.endsWith('.jar') &&
              !n.endsWith('-sources.jar') &&
              !n.endsWith('-javadoc.jar'),
          )
          .sort();
        const boot = jars.find(
          (n) => n.includes('boot') || n.includes('SNAPSHOT') || n.includes('all'),
        );
        const pick = boot ?? jars[jars.length - 1];
        if (pick) return `./${rel}/${pick}`;
      }
    } catch {
      /* skip */
    }
  }
  return undefined;
}

/** Detect Bun/TS entry under appDir. */
export function detectBunEntry(appDir: string): string | undefined {
  for (const rel of [
    'index.ts',
    'server.ts',
    'src/index.ts',
    'src/server.ts',
    'index.js',
    'server.js',
  ]) {
    if (existsSync(join(appDir, rel))) return rel;
  }
  return undefined;
}

/**
 * Render Apache VirtualHost + PHP-FPM pool fragment.
 */
export function renderPhpVhost(opts: {
  domain: string;
  docRoot: string;
  phpVersion: string;
  poolName: string;
}): string {
  return `<VirtualHost *:80>
  ServerName ${opts.domain}
  DocumentRoot ${opts.docRoot}
  <Directory ${opts.docRoot}>
    AllowOverride All
    Require all granted
  </Directory>
  <FilesMatch \\.php$>
    SetHandler "proxy:unix:/run/php/php${opts.phpVersion}-fpm-${opts.poolName}.sock|fcgi://localhost"
  </FilesMatch>
  ErrorLog \${APACHE_LOG_DIR}/${opts.poolName}-error.log
  CustomLog \${APACHE_LOG_DIR}/${opts.poolName}-access.log combined
</VirtualHost>
`;
}

/**
 * Installable version lists are empty by design — clients must use
 * GET /api/v1/system/software/versions (dynamic discovery).
 * Probe still finds *installed* pins via host scan (runtime-probe).
 */
export function listSupportedRuntimes(): {
  node: string[];
  php: string[];
  python: string[];
  go: string[];
  rust: string[];
  java: string[];
  kotlin: string[];
  bun: string[];
} {
  return {
    node: [],
    php: [],
    python: [],
    go: [],
    rust: [],
    java: [],
    kotlin: [],
    bun: [],
  };
}

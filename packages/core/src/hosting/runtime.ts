/**
 * Multi-version hosting runtime selection contracts.
 * Process apps: node | python | go | rust
 * PHP-FPM: php · Static files: static
 */

import { ErrorCodes, YskError } from '@ysk/shared';

export type RuntimeKind = 'node' | 'php' | 'python' | 'go' | 'rust';

export type ProjectRuntimeKind = 'node' | 'php' | 'static' | 'python' | 'go' | 'rust';

export type RuntimeManager =
  | 'nvm'
  | 'fnm'
  | 'nodesource'
  | 'ondrej-php'
  | 'deadsnakes'
  | 'go-official'
  | 'rustup'
  | 'system';

export interface RuntimeSelection {
  kind: RuntimeKind;
  version: string;
  /** Absolute path hint for binary on target host */
  binaryPath: string;
  manager: RuntimeManager;
}

export const NODE_SUPPORTED = ['18', '20', '22'] as const;
export const PHP_SUPPORTED = ['8.1', '8.2', '8.3'] as const;
export const PYTHON_SUPPORTED = ['3.10', '3.11', '3.12'] as const;
export const GO_SUPPORTED = ['1.21', '1.22', '1.23'] as const;
/** rustup channel or stable minor pin */
export const RUST_SUPPORTED = ['stable', '1.78', '1.81'] as const;

const PROCESS_RUNTIMES = new Set(['node', 'python', 'go', 'rust']);

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
    value === 'rust'
  );
}

/** Default version string per runtime when client omits runtimeVersion. */
export function defaultRuntimeVersion(runtime: ProjectRuntimeKind | string): string {
  if (runtime === 'php') return '8.2';
  if (runtime === 'node') return '20';
  if (runtime === 'python') return '3.12';
  if (runtime === 'go') return '1.22';
  if (runtime === 'rust') return 'stable';
  return '';
}

/**
 * Normalize / repair stored runtimeVersion.
 * Fixes historical bug: PHP projects incorrectly defaulted to Node "20".
 */
export function normalizeRuntimeVersion(
  runtime: ProjectRuntimeKind | string,
  version?: string | null,
): string {
  const raw = (version ?? '').trim();
  if (runtime === 'static') return '';

  if (runtime === 'php') {
    if (!raw || raw === '18' || raw === '20' || raw === '22' || /^v?\d+$/.test(raw)) {
      return defaultRuntimeVersion('php');
    }
    const normalized = raw.startsWith('php') ? raw.slice(3).replace(/^\s+/, '') : raw;
    if (PHP_SUPPORTED.includes(normalized as (typeof PHP_SUPPORTED)[number])) {
      return normalized;
    }
    if (/^\d+(\.\d+)?$/.test(normalized) && !normalized.includes('.')) {
      return defaultRuntimeVersion('php');
    }
    return PHP_SUPPORTED.includes(normalized as (typeof PHP_SUPPORTED)[number])
      ? normalized
      : defaultRuntimeVersion('php');
  }

  if (runtime === 'node') {
    if (!raw) return defaultRuntimeVersion('node');
    const major = raw.replace(/^v/, '').split('.')[0];
    if (NODE_SUPPORTED.includes(major as (typeof NODE_SUPPORTED)[number])) return major;
    return defaultRuntimeVersion('node');
  }

  if (runtime === 'python') {
    if (!raw) return defaultRuntimeVersion('python');
    const m = raw.replace(/^python/, '').trim();
    if (PYTHON_SUPPORTED.includes(m as (typeof PYTHON_SUPPORTED)[number])) return m;
    // Accept 3.12.1 → 3.12
    const minor = m.match(/^(\d+\.\d+)/)?.[1];
    if (minor && PYTHON_SUPPORTED.includes(minor as (typeof PYTHON_SUPPORTED)[number])) {
      return minor;
    }
    return defaultRuntimeVersion('python');
  }

  if (runtime === 'go') {
    if (!raw) return defaultRuntimeVersion('go');
    const m = raw.replace(/^go/, '').trim();
    if (GO_SUPPORTED.includes(m as (typeof GO_SUPPORTED)[number])) return m;
    const minor = m.match(/^(\d+\.\d+)/)?.[1];
    if (minor && GO_SUPPORTED.includes(minor as (typeof GO_SUPPORTED)[number])) return minor;
    return defaultRuntimeVersion('go');
  }

  if (runtime === 'rust') {
    if (!raw) return defaultRuntimeVersion('rust');
    if (raw === 'stable' || raw === 'nightly' || raw === 'beta') return raw === 'nightly' || raw === 'beta' ? 'stable' : raw;
    if (RUST_SUPPORTED.includes(raw as (typeof RUST_SUPPORTED)[number])) return raw;
    const minor = raw.match(/^(\d+\.\d+)/)?.[1];
    if (minor && RUST_SUPPORTED.includes(minor as (typeof RUST_SUPPORTED)[number])) return minor;
    return defaultRuntimeVersion('rust');
  }

  return raw;
}

export function selectNodeRuntime(version: string): RuntimeSelection {
  const major = version.replace(/^v/, '').split('.')[0];
  if (!NODE_SUPPORTED.includes(major as (typeof NODE_SUPPORTED)[number])) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      `不支援的 Node.js 版本 ${version}；可用主版本：${NODE_SUPPORTED.join(', ')}`,
      { httpStatus: 400 },
    );
  }
  return {
    kind: 'node',
    version: major,
    binaryPath: `/usr/local/ysk/node/${major}/bin/node`,
    manager: 'fnm',
  };
}

export function selectPhpRuntime(version: string): RuntimeSelection {
  const normalized = version.startsWith('php') ? version.slice(3) : version;
  if (!PHP_SUPPORTED.includes(normalized as (typeof PHP_SUPPORTED)[number])) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      `不支援的 PHP 版本 ${version}；可用：${PHP_SUPPORTED.join(', ')}`,
      { httpStatus: 400 },
    );
  }
  return {
    kind: 'php',
    version: normalized,
    binaryPath: `/usr/bin/php${normalized}`,
    manager: 'ondrej-php',
  };
}

export function selectPythonRuntime(version: string): RuntimeSelection {
  const raw = (version ?? '').replace(/^python/, '').trim();
  const minor = raw.match(/^(\d+\.\d+)/)?.[1] ?? raw;
  if (!PYTHON_SUPPORTED.includes(minor as (typeof PYTHON_SUPPORTED)[number])) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      `不支援的 Python 版本 ${version}；可用：${PYTHON_SUPPORTED.join(', ')}`,
      { httpStatus: 400 },
    );
  }
  return {
    kind: 'python',
    version: minor,
    binaryPath: `/usr/bin/python${minor}`,
    manager: 'deadsnakes',
  };
}

export function selectGoRuntime(version: string): RuntimeSelection {
  const raw = (version ?? '').replace(/^go/, '').trim();
  const minor = raw.match(/^(\d+\.\d+)/)?.[1] ?? raw;
  if (!GO_SUPPORTED.includes(minor as (typeof GO_SUPPORTED)[number])) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      `不支援的 Go 版本 ${version}；可用：${GO_SUPPORTED.join(', ')}`,
      { httpStatus: 400 },
    );
  }
  return {
    kind: 'go',
    version: minor,
    binaryPath: `/usr/local/ysk/go/${minor}/bin/go`,
    manager: 'go-official',
  };
}

export function selectRustRuntime(version: string): RuntimeSelection {
  const v = normalizeRuntimeVersion('rust', version);
  return {
    kind: 'rust',
    version: v,
    binaryPath:
      v === 'stable'
        ? '/usr/local/ysk/rust/bin/cargo'
        : `/usr/local/ysk/rust/toolchains/${v}-x86_64-unknown-linux-gnu/bin/cargo`,
    manager: 'rustup',
  };
}

export function selectRuntime(kind: RuntimeKind, version: string): RuntimeSelection {
  if (kind === 'node') return selectNodeRuntime(version);
  if (kind === 'php') return selectPhpRuntime(version);
  if (kind === 'python') return selectPythonRuntime(version);
  if (kind === 'go') return selectGoRuntime(version);
  if (kind === 'rust') return selectRustRuntime(version);
  throw new YskError(ErrorCodes.VALIDATION, `未知 runtime：${kind}`, { httpStatus: 400 });
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
}): string {
  return renderProcessUnit({
    projectName: opts.projectName,
    linuxUser: opts.linuxUser,
    appDir: opts.appDir,
    execStart: `${opts.nodeBinary} ${opts.entry}`,
    port: opts.port,
    env: { NODE_ENV: 'production', PORT: String(opts.port) },
    memoryMax: opts.memoryMax,
    cpuQuotaPercent: opts.cpuQuotaPercent,
    limitNOFILE: opts.limitNOFILE,
  });
}

/** Generic process unit for node/python/go/rust. */
export function renderProcessUnit(opts: {
  projectName: string;
  linuxUser: string;
  appDir: string;
  execStart: string;
  port: number;
  env?: Record<string, string>;
  memoryMax?: string;
  cpuQuotaPercent?: number;
  limitNOFILE?: number;
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
WorkingDirectory=${opts.appDir}
${envLines}
ExecStart=${opts.execStart}
Restart=on-failure
RestartSec=5
${limitBlock}
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
    const pyBuild =
      'python3 -m venv venv && ./venv/bin/pip install -U pip && (./venv/bin/pip install -r requirements.txt || true)';
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
  // node
  const entry = opts.entry ?? 'server.js';
  return {
    execStart: `node ${entry}`,
    entry,
  };
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

export function listSupportedRuntimes(): {
  node: string[];
  php: string[];
  python: string[];
  go: string[];
  rust: string[];
} {
  return {
    node: [...NODE_SUPPORTED],
    php: [...PHP_SUPPORTED],
    python: [...PYTHON_SUPPORTED],
    go: [...GO_SUPPORTED],
    rust: [...RUST_SUPPORTED],
  };
}

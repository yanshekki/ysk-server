/**
 * Companion tools / plugins for language runtimes (Node PM2, Python poetry, …).
 * PHP apt extensions stay in php-extensions.ts; this catalog covers all kinds
 * with a shared UI multi-select model.
 */

import type { RuntimeKind } from './runtime.js';

export type RuntimePluginInstaller =
  | 'npm-global'
  | 'apt'
  | 'pip'
  | 'go-install'
  | 'cargo-install'
  | 'rustup-component'
  | 'sdkman' // reserved
  | 'none';

export type RuntimePluginSpec = {
  id: string;
  kind: RuntimeKind;
  label: string;
  hint?: string;
  group?: string;
  recommended?: boolean;
  /** Always applied with runtime (not shown as optional, or shown locked) */
  required?: boolean;
  installer: RuntimePluginInstaller;
  npmPackages?: string[];
  aptPackages?: string[];
  pipPackages?: string[];
  /** e.g. github.com/air-verse/air@latest */
  goModules?: string[];
  cargoCrates?: string[];
  /** rustup component add … */
  rustupComponents?: string[];
  /** bins used for “already installed” probe hints */
  bins?: string[];
};

/**
 * Curated hosting-oriented tools per runtime.
 * Ids are stable API values sent as `plugins: string[]` on install.
 */
export const RUNTIME_PLUGINS: RuntimePluginSpec[] = [
  // —— Node.js ——
  {
    id: 'pm2',
    kind: 'node',
    label: 'PM2',
    hint: 'npm i -g pm2 — process manager',
    group: 'process',
    recommended: true,
    installer: 'npm-global',
    npmPackages: ['pm2'],
    bins: ['pm2'],
  },
  {
    id: 'yarn',
    kind: 'node',
    label: 'Yarn',
    hint: 'npm i -g yarn',
    group: 'package',
    recommended: true,
    installer: 'npm-global',
    npmPackages: ['yarn'],
    bins: ['yarn'],
  },
  {
    id: 'pnpm',
    kind: 'node',
    label: 'pnpm',
    hint: 'npm i -g pnpm',
    group: 'package',
    recommended: true,
    installer: 'npm-global',
    npmPackages: ['pnpm'],
    bins: ['pnpm'],
  },
  {
    id: 'typescript',
    kind: 'node',
    label: 'TypeScript',
    hint: 'npm i -g typescript',
    group: 'toolchain',
    recommended: true,
    installer: 'npm-global',
    npmPackages: ['typescript'],
    bins: ['tsc'],
  },
  {
    id: 'ts-node',
    kind: 'node',
    label: 'ts-node',
    hint: 'npm i -g ts-node',
    group: 'toolchain',
    installer: 'npm-global',
    npmPackages: ['ts-node'],
    bins: ['ts-node'],
  },
  {
    id: 'nodemon',
    kind: 'node',
    label: 'nodemon',
    hint: 'npm i -g nodemon',
    group: 'dev',
    installer: 'npm-global',
    npmPackages: ['nodemon'],
    bins: ['nodemon'],
  },
  {
    id: 'serve',
    kind: 'node',
    label: 'serve',
    hint: 'static file server (npm -g)',
    group: 'dev',
    installer: 'npm-global',
    npmPackages: ['serve'],
    bins: ['serve'],
  },

  // —— Python ——
  {
    id: 'venv',
    kind: 'python',
    label: 'venv',
    hint: 'python3-venv (apt)',
    group: 'core',
    recommended: true,
    installer: 'apt',
    aptPackages: ['python3-venv'],
    bins: [],
  },
  {
    id: 'pip',
    kind: 'python',
    label: 'pip',
    hint: 'python3-pip (apt)',
    group: 'core',
    recommended: true,
    installer: 'apt',
    aptPackages: ['python3-pip'],
    bins: ['pip3', 'pip'],
  },
  {
    id: 'poetry',
    kind: 'python',
    label: 'Poetry',
    hint: 'pip install poetry',
    group: 'package',
    recommended: true,
    installer: 'pip',
    pipPackages: ['poetry'],
    bins: ['poetry'],
  },
  {
    id: 'pipenv',
    kind: 'python',
    label: 'Pipenv',
    hint: 'pip install pipenv',
    group: 'package',
    installer: 'pip',
    pipPackages: ['pipenv'],
    bins: ['pipenv'],
  },
  {
    id: 'virtualenv',
    kind: 'python',
    label: 'virtualenv',
    hint: 'pip install virtualenv',
    group: 'package',
    installer: 'pip',
    pipPackages: ['virtualenv'],
    bins: ['virtualenv'],
  },
  {
    id: 'uvicorn',
    kind: 'python',
    label: 'Uvicorn',
    hint: 'ASGI server',
    group: 'web',
    recommended: true,
    installer: 'pip',
    pipPackages: ['uvicorn'],
    bins: ['uvicorn'],
  },
  {
    id: 'gunicorn',
    kind: 'python',
    label: 'Gunicorn',
    hint: 'WSGI server',
    group: 'web',
    recommended: true,
    installer: 'pip',
    pipPackages: ['gunicorn'],
    bins: ['gunicorn'],
  },
  {
    id: 'ruff',
    kind: 'python',
    label: 'Ruff',
    hint: 'linter / formatter',
    group: 'dev',
    installer: 'pip',
    pipPackages: ['ruff'],
    bins: ['ruff'],
  },
  {
    id: 'black',
    kind: 'python',
    label: 'Black',
    hint: 'code formatter',
    group: 'dev',
    installer: 'pip',
    pipPackages: ['black'],
    bins: ['black'],
  },

  // —— Go ——
  {
    id: 'air',
    kind: 'go',
    label: 'Air',
    hint: 'live reload (go install)',
    group: 'dev',
    recommended: true,
    installer: 'go-install',
    goModules: ['github.com/air-verse/air@latest'],
    bins: ['air'],
  },
  {
    id: 'golangci-lint',
    kind: 'go',
    label: 'golangci-lint',
    hint: 'go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest',
    group: 'dev',
    recommended: true,
    installer: 'go-install',
    goModules: ['github.com/golangci/golangci-lint/cmd/golangci-lint@latest'],
    bins: ['golangci-lint'],
  },
  {
    id: 'delve',
    kind: 'go',
    label: 'Delve',
    hint: 'debugger',
    group: 'dev',
    installer: 'go-install',
    goModules: ['github.com/go-delve/delve/cmd/dlv@latest'],
    bins: ['dlv'],
  },
  {
    id: 'staticcheck',
    kind: 'go',
    label: 'staticcheck',
    hint: 'honnef.co/go/tools/cmd/staticcheck',
    group: 'dev',
    installer: 'go-install',
    goModules: ['honnef.co/go/tools/cmd/staticcheck@latest'],
    bins: ['staticcheck'],
  },

  // —— Rust ——
  {
    id: 'clippy',
    kind: 'rust',
    label: 'Clippy',
    hint: 'rustup component add clippy',
    group: 'core',
    recommended: true,
    installer: 'rustup-component',
    rustupComponents: ['clippy'],
    bins: ['cargo-clippy'],
  },
  {
    id: 'rustfmt',
    kind: 'rust',
    label: 'rustfmt',
    hint: 'rustup component add rustfmt',
    group: 'core',
    recommended: true,
    installer: 'rustup-component',
    rustupComponents: ['rustfmt'],
    bins: ['rustfmt'],
  },
  {
    id: 'cargo-watch',
    kind: 'rust',
    label: 'cargo-watch',
    hint: 'cargo install cargo-watch',
    group: 'dev',
    recommended: true,
    installer: 'cargo-install',
    cargoCrates: ['cargo-watch'],
    bins: ['cargo-watch'],
  },
  {
    id: 'cargo-edit',
    kind: 'rust',
    label: 'cargo-edit',
    hint: 'cargo add / rm / upgrade',
    group: 'dev',
    installer: 'cargo-install',
    cargoCrates: ['cargo-edit'],
    bins: ['cargo-add'],
  },

  // —— Java ——
  {
    id: 'maven',
    kind: 'java',
    label: 'Maven',
    hint: 'apt maven',
    group: 'build',
    recommended: true,
    installer: 'apt',
    aptPackages: ['maven'],
    bins: ['mvn'],
  },
  {
    id: 'gradle',
    kind: 'java',
    label: 'Gradle',
    hint: 'apt gradle',
    group: 'build',
    recommended: true,
    installer: 'apt',
    aptPackages: ['gradle'],
    bins: ['gradle'],
  },

  // —— Kotlin ——
  {
    id: 'maven-kt',
    kind: 'kotlin',
    label: 'Maven',
    hint: 'apt maven (Kotlin projects)',
    group: 'build',
    recommended: true,
    installer: 'apt',
    aptPackages: ['maven'],
    bins: ['mvn'],
  },
  {
    id: 'gradle-kt',
    kind: 'kotlin',
    label: 'Gradle',
    hint: 'apt gradle',
    group: 'build',
    recommended: true,
    installer: 'apt',
    aptPackages: ['gradle'],
    bins: ['gradle'],
  },

  // —— Bun ——
  {
    id: 'bun-pm2',
    kind: 'bun',
    label: 'PM2',
    hint: 'needs Node/npm for global pm2; optional with Bun apps',
    group: 'process',
    installer: 'npm-global',
    npmPackages: ['pm2'],
    bins: ['pm2'],
  },
];

const BY_KIND = new Map<RuntimeKind, RuntimePluginSpec[]>();
for (const p of RUNTIME_PLUGINS) {
  const list = BY_KIND.get(p.kind) ?? [];
  list.push(p);
  BY_KIND.set(p.kind, list);
}

export function listRuntimePlugins(kind: RuntimeKind): RuntimePluginSpec[] {
  return (BY_KIND.get(kind) ?? []).map((p) => ({ ...p }));
}

export function defaultRuntimePluginIds(kind: RuntimeKind): string[] {
  return listRuntimePlugins(kind)
    .filter((p) => p.recommended || p.required)
    .map((p) => p.id);
}

export function resolveRuntimePlugins(
  kind: RuntimeKind,
  pluginIds?: string[] | null,
): { plugins: RuntimePluginSpec[]; ids: string[] } {
  const catalog = listRuntimePlugins(kind);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const required = catalog.filter((p) => p.required).map((p) => p.id);
  const extra =
    pluginIds == null ? defaultRuntimePluginIds(kind) : pluginIds.filter(Boolean);
  const ids = [...new Set([...required, ...extra])].filter((id) => byId.has(id));
  return {
    ids,
    plugins: ids.map((id) => byId.get(id)!),
  };
}

/**
 * Bash lines appended to runtime install.sh (best-effort; do not fail whole install).
 */
export function buildRuntimePluginScriptLines(
  kind: RuntimeKind,
  pluginIds?: string[] | null,
): { lines: string[]; ids: string[]; labels: string[] } {
  const { plugins, ids } = resolveRuntimePlugins(kind, pluginIds);
  if (!plugins.length) return { lines: [], ids: [], labels: [] };

  const lines: string[] = [
    '',
    '# —— Companion tools / plugins (best-effort) ——',
    'echo "Installing companion tools: ' + ids.join(', ') + '"',
    'export PATH="/usr/local/bin:/usr/local/ysk/node/*/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"',
  ];

  for (const p of plugins) {
    lines.push(`echo "→ ${p.label} (${p.id})"`);
    switch (p.installer) {
      case 'npm-global': {
        const pkgs = (p.npmPackages ?? []).map((x) => JSON.stringify(x)).join(' ');
        lines.push(
          `if command -v npm >/dev/null 2>&1; then npm install -g ${pkgs} || echo "skip ${p.id}: npm failed" >&2`,
          `elif command -v bun >/dev/null 2>&1; then bun add -g ${pkgs} || echo "skip ${p.id}: bun failed" >&2`,
          `else echo "skip ${p.id}: npm not found" >&2; fi`,
        );
        break;
      }
      case 'apt': {
        const pkgs = (p.aptPackages ?? []).join(' ');
        lines.push(
          `export DEBIAN_FRONTEND=noninteractive`,
          `apt-get install -y ${pkgs} || echo "skip ${p.id}: apt failed" >&2`,
        );
        break;
      }
      case 'pip': {
        const pkgs = (p.pipPackages ?? []).map((x) => JSON.stringify(x)).join(' ');
        lines.push(
          `if command -v pip3 >/dev/null 2>&1; then pip3 install --break-system-packages ${pkgs} 2>/dev/null || pip3 install ${pkgs} || echo "skip ${p.id}" >&2`,
          `elif command -v pip >/dev/null 2>&1; then pip install ${pkgs} || echo "skip ${p.id}" >&2`,
          `else echo "skip ${p.id}: pip not found" >&2; fi`,
        );
        break;
      }
      case 'go-install': {
        for (const mod of p.goModules ?? []) {
          lines.push(
            `if command -v go >/dev/null 2>&1; then go install ${JSON.stringify(mod)} || echo "skip ${mod}" >&2`,
            `else echo "skip ${p.id}: go not found" >&2; fi`,
          );
        }
        break;
      }
      case 'cargo-install': {
        for (const crate of p.cargoCrates ?? []) {
          lines.push(
            `if command -v cargo >/dev/null 2>&1; then cargo install ${JSON.stringify(crate)} || echo "skip ${crate}" >&2`,
            `else echo "skip ${p.id}: cargo not found" >&2; fi`,
          );
        }
        break;
      }
      case 'rustup-component': {
        for (const c of p.rustupComponents ?? []) {
          lines.push(
            `if command -v rustup >/dev/null 2>&1; then rustup component add ${JSON.stringify(c)} || echo "skip ${c}" >&2`,
            `elif [ -x /usr/local/ysk/rust/bin/rustup ]; then /usr/local/ysk/rust/bin/rustup component add ${JSON.stringify(c)} || true`,
            `else echo "skip ${p.id}: rustup not found" >&2; fi`,
          );
        }
        break;
      }
      default:
        lines.push(`echo "skip ${p.id}: no installer"`);
    }
  }

  return {
    lines,
    ids,
    labels: plugins.map((p) => p.label),
  };
}

/** API / UI DTO */
export function runtimePluginsCatalogDto(kind: RuntimeKind) {
  const plugins = listRuntimePlugins(kind);
  return {
    kind,
    plugins: plugins.map((p) => ({
      id: p.id,
      label: p.label,
      hint: p.hint,
      group: p.group,
      recommended: Boolean(p.recommended),
      required: Boolean(p.required),
      installer: p.installer,
      bins: p.bins ?? [],
    })),
    defaults: defaultRuntimePluginIds(kind),
  };
}

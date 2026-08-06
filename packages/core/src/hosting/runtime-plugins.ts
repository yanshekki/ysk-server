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
  /** Official Poetry installer (avoids PEP 668 / bare pip on Ubuntu) */
  | 'poetry-official'
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
    hint: 'official installer → /usr/local/ysk/poetry (not bare pip)',
    group: 'package',
    recommended: true,
    installer: 'poetry-official',
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
    // cargo-clippy lives under toolchain bin; also probe rustup component list
    bins: ['cargo-clippy', 'clippy-driver'],
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
    bins: ['rustfmt', 'cargo-fmt'],
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
    bins: ['cargo-add', 'cargo-rm', 'cargo-upgrade'],
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
    '# —— Companion tools / plugins ——',
    'YSK_PLUGIN_FAILED=""',
    'ysk_plugin_fail() { YSK_PLUGIN_FAILED="${YSK_PLUGIN_FAILED} $1"; echo "YSK_PLUGIN_SKIP:$1" >&2; }',
    'echo "Installing companion tools: ' + ids.join(', ') + '"',
    // Prefer concrete bin dirs (glob in PATH is unreliable)
    'export PATH="/usr/local/bin:/usr/local/ysk/poetry/bin:/usr/local/ysk/bun/bin:/usr/local/ysk/rust/bin:/usr/local/ysk/rust/cargo/bin:/usr/local/ysk/go/bin:$HOME/.local/bin:/root/.local/bin:$HOME/.cargo/bin:/root/.cargo/bin:$HOME/go/bin:/root/go/bin:$PATH"',
    'for _d in /usr/local/ysk/node/*/bin /usr/local/ysk/python/*/bin /usr/local/ysk/go/*/bin; do [ -d "$_d" ] && PATH="$_d:$PATH"; done',
    'export PATH',
    'export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"',
    'export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"',
    '[ -d /usr/local/ysk/rust ] && export RUSTUP_HOME="${RUSTUP_HOME:-/usr/local/ysk/rust/rustup}" CARGO_HOME="${CARGO_HOME:-/usr/local/ysk/rust/cargo}"',
    'export GOPATH="${GOPATH:-$HOME/go}"',
    'export GOBIN="${GOBIN:-}"',
  ];

  for (const p of plugins) {
    lines.push(`echo "→ ${p.label} (${p.id})"`);
    switch (p.installer) {
      case 'npm-global': {
        const pkgs = (p.npmPackages ?? []).map((x) => JSON.stringify(x)).join(' ');
        lines.push(
          `if command -v npm >/dev/null 2>&1; then npm install -g ${pkgs} || ysk_plugin_fail ${p.id}`,
          `elif command -v bun >/dev/null 2>&1; then bun add -g ${pkgs} || ysk_plugin_fail ${p.id}`,
          `else ysk_plugin_fail ${p.id}; fi`,
        );
        break;
      }
      case 'apt': {
        const pkgs = (p.aptPackages ?? []).join(' ');
        lines.push(
          `export DEBIAN_FRONTEND=noninteractive`,
          `apt-get install -y ${pkgs} || ysk_plugin_fail ${p.id}`,
        );
        break;
      }
      case 'poetry-official': {
        // Official installer → POETRY_HOME (avoids PEP 668). Fallback: pipx, then pip --break-system-packages.
        lines.push(
          'export PATH="/usr/local/ysk/poetry/bin:$HOME/.local/bin:/root/.local/bin:$PATH"',
          'if command -v poetry >/dev/null 2>&1; then poetry --version',
          'elif command -v pipx >/dev/null 2>&1; then',
          '  pipx install poetry && export PATH="$HOME/.local/bin:$PATH" && command -v poetry || ysk_plugin_fail poetry',
          'else',
          '  export DEBIAN_FRONTEND=noninteractive',
          '  apt-get install -y python3-pip python3-venv curl ca-certificates 2>/dev/null || true',
          '  export POETRY_HOME=/usr/local/ysk/poetry',
          '  mkdir -p "$POETRY_HOME"',
          '  if curl -fsSL https://install.python-poetry.org | python3 -; then',
          '    ln -sfn "$POETRY_HOME/bin/poetry" /usr/local/bin/poetry || true',
          '    export PATH="$POETRY_HOME/bin:/usr/local/bin:$PATH"',
          '    command -v poetry || ysk_plugin_fail poetry',
          '  elif python3 -m pip install --break-system-packages poetry 2>/dev/null || python3 -m pip install poetry; then',
          '    export PATH="$HOME/.local/bin:/root/.local/bin:$PATH"',
          '    command -v poetry || ysk_plugin_fail poetry',
          '  else ysk_plugin_fail poetry; fi',
          'fi',
        );
        break;
      }
      case 'pip': {
        const pkgs = (p.pipPackages ?? []).map((x) => JSON.stringify(x)).join(' ');
        // Prefer python3 -m pip (PEP 668: --break-system-packages); ensure pip present
        lines.push(
          'export DEBIAN_FRONTEND=noninteractive',
          'command -v pip3 >/dev/null 2>&1 || command -v pip >/dev/null 2>&1 || apt-get install -y python3-pip 2>/dev/null || true',
          `if python3 -m pip install --break-system-packages ${pkgs} 2>/dev/null; then true`,
          `elif python3 -m pip install ${pkgs} 2>/dev/null; then true`,
          `elif command -v pip3 >/dev/null 2>&1; then pip3 install --break-system-packages ${pkgs} 2>/dev/null || pip3 install ${pkgs} || ysk_plugin_fail ${p.id}`,
          `elif command -v pip >/dev/null 2>&1; then pip install ${pkgs} || ysk_plugin_fail ${p.id}`,
          `else ysk_plugin_fail ${p.id}; fi`,
          // pip may drop scripts under ~/.local/bin
          'export PATH="$HOME/.local/bin:/root/.local/bin:$PATH"',
        );
        break;
      }
      case 'go-install': {
        for (const mod of p.goModules ?? []) {
          const bin = (p.bins && p.bins[0]) || mod.split('/').pop()?.split('@')[0] || p.id;
          lines.push(
            'ysk_go() { command -v go 2>/dev/null || { [ -x /usr/local/ysk/go/bin/go ] && echo /usr/local/ysk/go/bin/go; }; for _g in /usr/local/ysk/go/*/bin/go; do [ -x "$_g" ] && echo "$_g" && return; done; true; }',
            `GO_BIN="$(ysk_go)"`,
            `if [ -n "$GO_BIN" ]; then`,
            // Install into GOPATH/bin then symlink so panel probe always finds it
            `  export PATH="$(dirname "$GO_BIN"):$PATH"`,
            `  export GOPATH="\${GOPATH:-$HOME/go}"`,
            `  "$GO_BIN" install ${JSON.stringify(mod)} || ysk_plugin_fail ${p.id}`,
            `  for _cand in "$GOPATH/bin/${bin}" "$HOME/go/bin/${bin}" /root/go/bin/${bin} /usr/local/ysk/go/bin/${bin}; do`,
            `    if [ -x "$_cand" ]; then ln -sfn "$_cand" /usr/local/bin/${bin} 2>/dev/null || true; break; fi`,
            `  done`,
            `  export PATH="/usr/local/bin:$GOPATH/bin:$HOME/go/bin:/root/go/bin:$PATH"`,
            `  command -v ${JSON.stringify(bin)} >/dev/null 2>&1 || ysk_plugin_fail ${p.id}`,
            `else ysk_plugin_fail ${p.id}; fi`,
          );
        }
        break;
      }
      case 'cargo-install': {
        for (const crate of p.cargoCrates ?? []) {
          const bin = (p.bins && p.bins[0]) || crate;
          lines.push(
            'ysk_cargo() { command -v cargo 2>/dev/null || { [ -x /usr/local/ysk/rust/bin/cargo ] && echo /usr/local/ysk/rust/bin/cargo; }; }',
            `CARGO_BIN="$(ysk_cargo)"`,
            `if [ -n "$CARGO_BIN" ]; then`,
            `  "$CARGO_BIN" install ${JSON.stringify(crate)} --locked 2>/dev/null || "$CARGO_BIN" install ${JSON.stringify(crate)} || ysk_plugin_fail ${p.id}`,
            // Symlink into /usr/local/bin so panel probe (command -v) always finds it
            `  for _cand in "$CARGO_HOME/bin/${bin}" "$HOME/.cargo/bin/${bin}" /root/.cargo/bin/${bin} /usr/local/ysk/rust/cargo/bin/${bin}; do`,
            `    if [ -x "$_cand" ]; then ln -sfn "$_cand" /usr/local/bin/${bin} 2>/dev/null || true; break; fi`,
            `  done`,
            `  export PATH="/usr/local/bin:$CARGO_HOME/bin:$PATH"`,
            `  command -v ${JSON.stringify(bin)} >/dev/null 2>&1 || ysk_plugin_fail ${p.id}`,
            `else ysk_plugin_fail ${p.id}; fi`,
          );
        }
        break;
      }
      case 'rustup-component': {
        for (const c of p.rustupComponents ?? []) {
          lines.push(
            'ysk_rustup() { command -v rustup 2>/dev/null || { [ -x /usr/local/ysk/rust/bin/rustup ] && echo /usr/local/ysk/rust/bin/rustup; }; }',
            `RU="$(ysk_rustup)"`,
            `if [ -n "$RU" ]; then`,
            `  "$RU" component add ${JSON.stringify(c)} || ysk_plugin_fail ${p.id}`,
            // Ensure toolchain bins on PATH + optional symlinks for probe
            `  export PATH="$("$RU" which rustc 2>/dev/null | xargs -r dirname 2>/dev/null):$HOME/.cargo/bin:/root/.cargo/bin:/usr/local/ysk/rust/bin:$PATH"`,
            `  if [ ${JSON.stringify(c)} = "clippy" ]; then`,
            `    command -v cargo-clippy >/dev/null 2>&1 || "$RU" which cargo-clippy >/dev/null 2>&1 || ysk_plugin_fail ${p.id}`,
            `  elif [ ${JSON.stringify(c)} = "rustfmt" ]; then`,
            `    command -v rustfmt >/dev/null 2>&1 || "$RU" which rustfmt >/dev/null 2>&1 || ysk_plugin_fail ${p.id}`,
            `  fi`,
            // Verify via rustup component list (authoritative)
            `  "$RU" component list --installed 2>/dev/null | grep -qiE ${JSON.stringify(c)} || ysk_plugin_fail ${p.id}`,
            `else ysk_plugin_fail ${p.id}; fi`,
          );
        }
        break;
      }
      default:
        lines.push(`ysk_plugin_fail ${p.id}`);
    }
  }

  lines.push(
    'if [ -n "${YSK_PLUGIN_FAILED// }" ]; then',
    '  echo "YSK_PLUGIN_FAILED:${YSK_PLUGIN_FAILED}"',
    '  exit 3',
    'fi',
    'echo "YSK_PLUGIN_OK=1"',
  );

  return {
    lines,
    ids,
    labels: plugins.map((p) => p.label),
  };
}

/**
 * Bash lines to uninstall companion tools (best-effort reverse of install).
 * Skips `required` plugins. Caller should only pass ids the user confirmed.
 */
export function buildRuntimePluginUninstallScriptLines(
  kind: RuntimeKind,
  pluginIds: string[] | null | undefined,
): { lines: string[]; ids: string[]; labels: string[] } {
  const catalog = listRuntimePlugins(kind);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const ids = [...new Set((pluginIds ?? []).filter(Boolean))].filter((id) => {
    const p = byId.get(id);
    return Boolean(p && !p.required);
  });
  const plugins = ids.map((id) => byId.get(id)!);
  if (!plugins.length) return { lines: [], ids: [], labels: [] };

  const lines: string[] = [
    '#!/usr/bin/env bash',
    '# YSK Server — uninstall companion tools',
    'set -uo pipefail',
    'YSK_PLUGIN_FAILED=""',
    'ysk_plugin_fail() { YSK_PLUGIN_FAILED="${YSK_PLUGIN_FAILED} $1"; echo "YSK_PLUGIN_SKIP:$1" >&2; }',
    'echo "Uninstalling companion tools: ' + ids.join(', ') + '"',
    'export PATH="/usr/local/bin:/usr/local/ysk/poetry/bin:/usr/local/ysk/bun/bin:/usr/local/ysk/go/bin:$HOME/.local/bin:/root/.local/bin:$HOME/.cargo/bin:/root/.cargo/bin:$HOME/go/bin:/root/go/bin:$PATH"',
    'for _d in /usr/local/ysk/node/*/bin /usr/local/ysk/go/*/bin; do [ -d "$_d" ] && PATH="$_d:$PATH"; done',
    'export PATH',
  ];

  for (const p of plugins) {
    lines.push(`echo "← ${p.label} (${p.id})"`);
    switch (p.installer) {
      case 'npm-global': {
        const pkgs = (p.npmPackages ?? []).map((x) => JSON.stringify(x)).join(' ');
        lines.push(
          `if command -v npm >/dev/null 2>&1; then npm uninstall -g ${pkgs} || ysk_plugin_fail ${p.id}`,
          `elif command -v bun >/dev/null 2>&1; then bun remove -g ${pkgs} || ysk_plugin_fail ${p.id}`,
          `else ysk_plugin_fail ${p.id}; fi`,
        );
        break;
      }
      case 'apt': {
        const pkgs = (p.aptPackages ?? []).join(' ');
        lines.push(
          `export DEBIAN_FRONTEND=noninteractive`,
          `apt-get remove -y ${pkgs} || ysk_plugin_fail ${p.id}`,
        );
        break;
      }
      case 'poetry-official': {
        lines.push(
          'export PATH="/usr/local/ysk/poetry/bin:$HOME/.local/bin:$PATH"',
          'if [ -x /usr/local/ysk/poetry/bin/poetry ] || [ -d /usr/local/ysk/poetry ]; then',
          '  curl -fsSL https://install.python-poetry.org | POETRY_HOME=/usr/local/ysk/poetry python3 - --uninstall 2>/dev/null || true',
          '  rm -rf /usr/local/ysk/poetry',
          '  rm -f /usr/local/bin/poetry',
          'elif command -v pipx >/dev/null 2>&1; then pipx uninstall poetry || ysk_plugin_fail poetry',
          'elif python3 -m pip uninstall -y poetry 2>/dev/null; then true',
          'else ysk_plugin_fail poetry; fi',
        );
        break;
      }
      case 'pip': {
        const pkgs = (p.pipPackages ?? []).map((x) => JSON.stringify(x)).join(' ');
        lines.push(
          `if python3 -m pip uninstall -y ${pkgs} 2>/dev/null; then true`,
          `elif command -v pip3 >/dev/null 2>&1; then pip3 uninstall -y ${pkgs} || ysk_plugin_fail ${p.id}`,
          `elif command -v pip >/dev/null 2>&1; then pip uninstall -y ${pkgs} || ysk_plugin_fail ${p.id}`,
          `else ysk_plugin_fail ${p.id}; fi`,
        );
        break;
      }
      case 'go-install': {
        // Only remove bins under go install / ysk layouts — never rm system /usr/bin/*
        const bins = (p.bins ?? []).filter(Boolean);
        if (bins.length) {
          lines.push(
            'ysk_rm_go_bin() {',
            '  local b="$1" p',
            '  for p in "$HOME/go/bin/$b" "/root/go/bin/$b" "${GOPATH:-$HOME/go}/bin/$b" "/usr/local/ysk/go/bin/$b" "/usr/local/bin/$b"; do',
            '    if [ -e "$p" ] || [ -L "$p" ]; then',
            '      case "$p" in',
            '        "$HOME"/go/bin/*|*/go/bin/*|/root/go/bin/*|/usr/local/ysk/*|/usr/local/bin/*) rm -f "$p" || return 1 ;;',
            '      esac',
            '    fi',
            '  done',
            '  p="$(command -v "$b" 2>/dev/null || true)"',
            '  [ -n "$p" ] || return 0',
            '  case "$p" in',
            '    "$HOME"/go/bin/*|*/go/bin/*|/root/go/bin/*|/usr/local/go/bin/*|/usr/local/ysk/*|*/.cache/go-build/*) rm -f "$p" || return 1 ;;',
            '    *) echo "YSK_PLUGIN_SKIP_PATH:$b:$p (not under go/ysk bin)" >&2; return 0 ;;',
            '  esac',
            '}',
          );
          for (const b of bins) {
            lines.push(
              `ysk_rm_go_bin ${JSON.stringify(b)} || ysk_plugin_fail ${p.id}`,
            );
          }
        } else {
          lines.push(`ysk_plugin_fail ${p.id}`);
        }
        break;
      }
      case 'cargo-install': {
        for (const crate of p.cargoCrates ?? []) {
          lines.push(
            `if command -v cargo >/dev/null 2>&1; then cargo uninstall ${JSON.stringify(crate)} || ysk_plugin_fail ${p.id}`,
            `else ysk_plugin_fail ${p.id}; fi`,
          );
        }
        break;
      }
      case 'rustup-component': {
        for (const c of p.rustupComponents ?? []) {
          lines.push(
            `if command -v rustup >/dev/null 2>&1; then rustup component remove ${JSON.stringify(c)} || ysk_plugin_fail ${p.id}`,
            `elif [ -x /usr/local/ysk/rust/bin/rustup ]; then /usr/local/ysk/rust/bin/rustup component remove ${JSON.stringify(c)} || ysk_plugin_fail ${p.id}`,
            `else ysk_plugin_fail ${p.id}; fi`,
          );
        }
        break;
      }
      default:
        lines.push(`ysk_plugin_fail ${p.id}`);
    }
  }

  lines.push(
    'if [ -n "${YSK_PLUGIN_FAILED// }" ]; then',
    '  echo "YSK_PLUGIN_FAILED:${YSK_PLUGIN_FAILED}"',
    '  exit 3',
    'fi',
    'echo "YSK_PLUGIN_UNINSTALL_OK=1"',
  );

  return {
    lines,
    ids,
    labels: plugins.map((p) => p.label),
  };
}

export type RuntimePluginUninstallResult = {
  ok: boolean;
  kind: RuntimeKind;
  notes: string[];
  pluginIds: string[];
  blocked?: boolean;
  blockMessage?: string;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
};

export type RuntimePluginInstallResult = RuntimePluginUninstallResult;

/**
 * Install companion plugins only (no full runtime tarball/apt stack).
 */
export async function installRuntimePlugins(input: {
  dataDir: string;
  host: {
    executeEnabled: () => boolean;
    isRoot: () => boolean;
    runCommand: (
      argv: string[],
      opts?: { timeoutMs?: number },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  kind: RuntimeKind;
  plugins: string[];
}): Promise<RuntimePluginInstallResult> {
  const { join } = await import('node:path');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { tl } = await import('@ysk/shared');

  const built = buildRuntimePluginScriptLines(input.kind, input.plugins);
  const notes: string[] = [];
  if (!built.ids.length) {
    return {
      ok: false,
      kind: input.kind,
      notes: [tl('notes.runtime.pluginsNoneToUninstall')],
      pluginIds: [],
    };
  }

  const dir = join(input.dataDir, 'runtimes', input.kind, '_plugins');
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, 'install-plugins.sh');
  const body = ['#!/usr/bin/env bash', 'set -uo pipefail', ...built.lines].join('\n') + '\n';
  writeFileSync(scriptPath, body, 'utf8');
  notes.push(
    tl('notes.runtime.plugins', {
      list: built.labels.join(', ') || built.ids.join(', '),
    }),
  );

  const execOn = input.host.executeEnabled();
  const rootOn = input.host.isRoot();
  if (!execOn || !rootOn) {
    const blockMessage = !execOn ? tl('ops.blocked.install') : tl('notes.auto.n1582');
    return {
      ok: false,
      kind: input.kind,
      notes: [blockMessage, ...notes],
      pluginIds: built.ids,
      blocked: true,
      blockMessage,
      requiresExecute: !execOn,
      requiresRoot: !rootOn,
    };
  }

  const r = await input.host.runCommand(['bash', scriptPath], { timeoutMs: 600_000 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const pluginFailMatch = out.match(/YSK_PLUGIN_FAILED:([^\n]+)/);
  const pluginFailed = pluginFailMatch
    ? pluginFailMatch[1]!
        .trim()
        .split(/\s+/)
        .filter(Boolean)
    : [];

  if (r.exitCode === 0) {
    notes.push(tl('notes.runtime.pluginsOk'));
    return { ok: true, kind: input.kind, notes, pluginIds: built.ids };
  }
  if (pluginFailed.length) {
    notes.unshift(tl('notes.runtime.pluginsFailed', { list: pluginFailed.join(', ') }));
  } else {
    notes.unshift(
      tl('notes.runtime.pluginsFailed', {
        list: (r.stderr || r.stdout || String(r.exitCode)).slice(0, 300),
      }),
    );
  }
  return { ok: false, kind: input.kind, notes, pluginIds: built.ids };
}

/**
 * Uninstall selected companion plugins on the host (root + execute).
 */
export async function uninstallRuntimePlugins(input: {
  dataDir: string;
  host: {
    executeEnabled: () => boolean;
    isRoot: () => boolean;
    runCommand: (
      argv: string[],
      opts?: { timeoutMs?: number },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  kind: RuntimeKind;
  plugins: string[];
}): Promise<RuntimePluginUninstallResult> {
  const { join } = await import('node:path');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { tl } = await import('@ysk/shared');

  const built = buildRuntimePluginUninstallScriptLines(input.kind, input.plugins);
  const notes: string[] = [];
  if (!built.ids.length) {
    return {
      ok: false,
      kind: input.kind,
      notes: [tl('notes.runtime.pluginsNoneToUninstall')],
      pluginIds: [],
    };
  }

  const dir = join(input.dataDir, 'runtimes', input.kind, '_plugins');
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, 'uninstall-plugins.sh');
  writeFileSync(scriptPath, built.lines.join('\n') + '\n', 'utf8');
  notes.push(
    tl('notes.runtime.pluginsUninstall', {
      list: built.labels.join(', ') || built.ids.join(', '),
    }),
  );

  const execOn = input.host.executeEnabled();
  const rootOn = input.host.isRoot();
  if (!execOn || !rootOn) {
    const blockMessage = !execOn
      ? tl('ops.blocked.install')
      : tl('notes.auto.n1582');
    return {
      ok: false,
      kind: input.kind,
      notes: [blockMessage, ...notes],
      pluginIds: built.ids,
      blocked: true,
      blockMessage,
      requiresExecute: !execOn,
      requiresRoot: !rootOn,
    };
  }

  const r = await input.host.runCommand(['bash', scriptPath], { timeoutMs: 300_000 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const pluginFailMatch = out.match(/YSK_PLUGIN_FAILED:([^\n]+)/);
  const pluginFailed = pluginFailMatch
    ? pluginFailMatch[1]!
        .trim()
        .split(/\s+/)
        .filter(Boolean)
    : [];

  if (r.exitCode === 0) {
    notes.push(tl('notes.runtime.pluginsUninstallOk'));
    return { ok: true, kind: input.kind, notes, pluginIds: built.ids };
  }
  if (pluginFailed.length) {
    notes.unshift(
      tl('notes.runtime.pluginsUninstallFailed', { list: pluginFailed.join(', ') }),
    );
  } else {
    notes.unshift(
      tl('notes.runtime.pluginsUninstallFailed', {
        list: (r.stderr || r.stdout || String(r.exitCode)).slice(0, 300),
      }),
    );
  }
  return {
    ok: false,
    kind: input.kind,
    notes,
    pluginIds: built.ids,
  };
}

/** API / UI DTO (sync; installed flags filled by async probe helper) */
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
      installed: false as boolean,
    })),
    defaults: defaultRuntimePluginIds(kind),
  };
}

/** Shell PATH prefix shared by install scripts and probe (cargo/rustup homes). */
export function pluginProbePathExport(): string {
  return [
    'export PATH="/usr/local/bin:/usr/local/ysk/poetry/bin:/usr/local/ysk/bun/bin:/usr/local/ysk/rust/bin:/usr/local/ysk/rust/cargo/bin:/usr/local/ysk/go/bin:$HOME/.local/bin:/root/.local/bin:$HOME/.cargo/bin:/root/.cargo/bin:$HOME/go/bin:/root/go/bin:${GOPATH:-$HOME/go}/bin:$PATH"',
    'for _d in /usr/local/ysk/node/*/bin /usr/local/ysk/python/*/bin /usr/local/ysk/go/*/bin; do [ -d "$_d" ] && PATH="$_d:$PATH"; done',
    'export PATH',
    'RU="$(command -v rustup 2>/dev/null || true)"',
    '[ -z "$RU" ] && [ -x /usr/local/ysk/rust/bin/rustup ] && RU=/usr/local/ysk/rust/bin/rustup',
    'if [ -n "$RU" ]; then',
    '  _tb="$("$RU" which rustc 2>/dev/null | xargs -r dirname 2>/dev/null || true)"',
    '  [ -n "$_tb" ] && PATH="$_tb:$PATH"',
    'fi',
    'export PATH',
  ].join('\n');
}

/**
 * Probe which plugins already exist.
 * - bins: command -v with cargo/rustup PATH
 * - rustup-component: also `rustup component list --installed`
 * Defaults = recommended && !installed.
 */
export async function runtimePluginsCatalogWithProbe(
  kind: RuntimeKind,
  host: {
    runCommand: (
      argv: string[],
      opts?: { timeoutMs?: number },
    ) => Promise<{ exitCode: number; stdout: string }>;
  },
) {
  const base = runtimePluginsCatalogDto(kind);
  const pathPreamble = pluginProbePathExport();

  // Single host shell: print INSTALLED:<id> for each found plugin
  const checks: string[] = [pathPreamble, 'set +e'];

  const fullSpecs = listRuntimePlugins(kind);
  const byId = new Map(fullSpecs.map((s) => [s.id, s]));

  for (const p of base.plugins) {
    const pluginId = p.id;
    const spec = byId.get(pluginId);
    const bins = (p.bins ?? []).filter(Boolean);
    const comps = spec?.rustupComponents ?? [];
    const binTests = bins
      .map((b) => `command -v ${JSON.stringify(b)} >/dev/null 2>&1`)
      .join(' || ');
    const pathTests = bins
      .flatMap((b) => [
        `[ -x "/usr/local/bin/${b}" ]`,
        `[ -x "$HOME/go/bin/${b}" ]`,
        `[ -x "/root/go/bin/${b}" ]`,
        `[ -x "\${GOPATH:-$HOME/go}/bin/${b}" ]`,
        `[ -x "/usr/local/ysk/go/bin/${b}" ]`,
        `[ -x "$HOME/.cargo/bin/${b}" ]`,
        `[ -x "/root/.cargo/bin/${b}" ]`,
        `[ -x "/usr/local/ysk/rust/cargo/bin/${b}" ]`,
        `[ -x "$HOME/.local/bin/${b}" ]`,
        `[ -x "/root/.local/bin/${b}" ]`,
      ])
      .join(' || ');

    if (spec?.installer === 'rustup-component' && comps.length) {
      const c = comps[0]!;
      checks.push(
        `{`,
        `  ok=0`,
        `  if [ -n "$RU" ]; then`,
        `    "$RU" component list --installed 2>/dev/null | grep -qiE ${JSON.stringify(c)} && ok=1`,
        `  fi`,
        `  if [ "$ok" = 0 ]; then`,
        `    ${binTests || 'false'} || ${pathTests || 'false'} && ok=1`,
        `  fi`,
        `  [ "$ok" = 1 ] && echo INSTALLED:${pluginId}`,
        `}`,
      );
    } else if (bins.length) {
      checks.push(
        `{ (${binTests}) || (${pathTests}); } && echo INSTALLED:${pluginId}`,
      );
    } else if (spec?.installer === 'apt' && (spec.aptPackages?.length ?? 0) > 0) {
      // apt packages without bins (e.g. python3-venv): dpkg
      const pkg = spec.aptPackages![0]!;
      checks.push(
        `dpkg -s ${JSON.stringify(pkg)} 2>/dev/null | grep -q '^Status:.*installed' && echo INSTALLED:${pluginId}`,
      );
    }
  }

  let installedSet = new Set<string>();
  try {
    const r = await host.runCommand(['bash', '-c', checks.join('\n')], {
      timeoutMs: 20_000,
    });
    for (const line of (r.stdout || '').split('\n')) {
      const m = line.trim().match(/^INSTALLED:(\S+)/);
      if (m) installedSet.add(m[1]!);
    }
  } catch {
    installedSet = new Set();
  }

  // Fallback per-bin probe if batch shell produced nothing (test mocks)
  if (installedSet.size === 0) {
    for (const p of base.plugins) {
      for (const bin of p.bins ?? []) {
        if (!bin) continue;
        try {
          const r = await host.runCommand(
            [
              'bash',
              '-c',
              `${pathPreamble}\ncommand -v ${JSON.stringify(bin)}`,
            ],
            { timeoutMs: 4_000 },
          );
          if (r.exitCode === 0 && r.stdout.trim()) {
            installedSet.add(p.id);
            break;
          }
        } catch {
          /* */
        }
      }
    }
  }

  const plugins = base.plugins.map((p) => ({
    ...p,
    installed: installedSet.has(p.id),
  }));
  const defaults = plugins
    .filter((p) => (p.recommended || p.required) && !p.installed)
    .map((p) => p.id);
  for (const p of plugins) {
    if (p.required && !defaults.includes(p.id)) defaults.push(p.id);
  }
  return { kind, plugins, defaults };
}

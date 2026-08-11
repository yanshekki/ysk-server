/**
 * Panel-preferred runtime versions (new projects / templates).
 * Independent of host PATH default (CLI symlink / rustup).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeKind } from './runtime.js';
import { defaultRuntimeVersion } from './runtime.js';

export type PanelRuntimeDefaults = Partial<Record<RuntimeKind, string>>;

function pathFor(dataDir: string): string {
  return join(dataDir, 'runtimes', 'panel-defaults.json');
}

export function loadPanelRuntimeDefaults(dataDir: string): PanelRuntimeDefaults {
  const p = pathFor(dataDir);
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as PanelRuntimeDefaults;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function savePanelRuntimeDefault(
  dataDir: string,
  kind: RuntimeKind,
  version: string,
): PanelRuntimeDefaults {
  const v = String(version ?? '').trim();
  if (!v) throw new Error('version required');
  const dir = join(dataDir, 'runtimes');
  mkdirSync(dir, { recursive: true });
  const cur = loadPanelRuntimeDefaults(dataDir);
  cur[kind] = v;
  writeFileSync(pathFor(dataDir), JSON.stringify(cur, null, 2) + '\n', 'utf8');
  return cur;
}

/** Prefer panel default, then hard-coded fallback. */
export function resolvePanelRuntimeVersion(
  dataDir: string | undefined,
  kind: string,
): string {
  if (dataDir) {
    const fromPanel = loadPanelRuntimeDefaults(dataDir)[kind as RuntimeKind];
    if (fromPanel?.trim()) return fromPanel.trim();
  }
  return defaultRuntimeVersion(kind);
}

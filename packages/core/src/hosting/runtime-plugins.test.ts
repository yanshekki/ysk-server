import { describe, expect, it } from 'vitest';
import {
  buildRuntimePluginScriptLines,
  buildRuntimePluginUninstallScriptLines,
  defaultRuntimePluginIds,
  listRuntimePlugins,
  resolveRuntimePlugins,
  runtimePluginsCatalogDto,
  uninstallRuntimePlugins,
} from './runtime-plugins.js';

describe('runtime-plugins', () => {
  it('lists node tools including pm2 as sole recommended default', () => {
    const node = listRuntimePlugins('node');
    expect(node.some((p) => p.id === 'pm2' && p.recommended)).toBe(true);
    expect(defaultRuntimePluginIds('node')).toEqual(['pm2']);
  });

  it('resolves null → defaults; [] → only required', () => {
    const defs = resolveRuntimePlugins('node', null);
    expect(defs.ids).toContain('pm2');
    const empty = resolveRuntimePlugins('python', []);
    expect(empty.ids.every((id) => listRuntimePlugins('python').find((p) => p.id === id)?.required)).toBe(
      true,
    );
  });

  it('builds npm install lines for pm2 with fail tracking', () => {
    const { lines, ids } = buildRuntimePluginScriptLines('node', ['pm2', 'yarn']);
    expect(ids).toEqual(expect.arrayContaining(['pm2', 'yarn']));
    const body = lines.join('\n');
    expect(body).toMatch(/npm install -g/);
    expect(body).toMatch(/pm2/);
    expect(body).toContain('YSK_PLUGIN_FAILED');
    expect(body).toContain('ysk_plugin_fail');
  });

  it('poetry uses official installer not bare pip only', () => {
    const { lines, ids } = buildRuntimePluginScriptLines('python', ['poetry']);
    expect(ids).toEqual(['poetry']);
    const body = lines.join('\n');
    expect(body).toMatch(/install\.python-poetry\.org/);
    expect(body).toMatch(/POETRY_HOME/);
    expect(body).toMatch(/ysk_plugin_fail poetry/);
  });

  it('dto for each kind', () => {
    for (const kind of ['node', 'python', 'go', 'rust', 'java', 'kotlin', 'bun'] as const) {
      const dto = runtimePluginsCatalogDto(kind);
      expect(dto.kind).toBe(kind);
      expect(Array.isArray(dto.plugins)).toBe(true);
    }
  });

  it('builds uninstall lines for npm-global and skips empty', () => {
    const empty = buildRuntimePluginUninstallScriptLines('node', []);
    expect(empty.ids).toEqual([]);
    const { lines, ids } = buildRuntimePluginUninstallScriptLines('node', ['pm2']);
    expect(ids).toEqual(['pm2']);
    expect(lines.join('\n')).toMatch(/npm uninstall -g/);
  });

  it('go uninstall only removes bins under go/ysk paths', () => {
    const air = listRuntimePlugins('go').find((p) => p.installer === 'go-install');
    if (!air) return;
    const { lines } = buildRuntimePluginUninstallScriptLines('go', [air.id]);
    const body = lines.join('\n');
    expect(body).toMatch(/ysk_rm_go_bin/);
    expect(body).toMatch(/YSK_PLUGIN_SKIP_PATH|go\/bin|ysk/);
    expect(body).not.toMatch(/rm -f "\$\(command -v/);
  });

  it('uninstallRuntimePlugins blocked without execute', async () => {
    const r = await uninstallRuntimePlugins({
      dataDir: '/tmp/ysk-test-plugins',
      host: {
        executeEnabled: () => false,
        isRoot: () => true,
        runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      },
      kind: 'node',
      plugins: ['pm2'],
    });
    expect(r.blocked).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('installRuntimePlugins builds and blocks without execute', async () => {
    const { installRuntimePlugins } = await import('./runtime-plugins.js');
    const r = await installRuntimePlugins({
      dataDir: '/tmp/ysk-test-plugins-i',
      host: {
        executeEnabled: () => false,
        isRoot: () => true,
        runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      },
      kind: 'node',
      plugins: ['pm2'],
    });
    expect(r.blocked).toBe(true);
    expect(r.pluginIds).toContain('pm2');
  });
});

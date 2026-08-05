import { describe, expect, it } from 'vitest';
import {
  buildRuntimePluginScriptLines,
  defaultRuntimePluginIds,
  listRuntimePlugins,
  resolveRuntimePlugins,
  runtimePluginsCatalogDto,
} from './runtime-plugins.js';

describe('runtime-plugins', () => {
  it('lists node tools including pm2 as recommended', () => {
    const node = listRuntimePlugins('node');
    expect(node.some((p) => p.id === 'pm2' && p.recommended)).toBe(true);
    expect(defaultRuntimePluginIds('node')).toContain('pm2');
  });

  it('resolves null → defaults; [] → only required', () => {
    const defs = resolveRuntimePlugins('node', null);
    expect(defs.ids).toContain('pm2');
    const empty = resolveRuntimePlugins('python', []);
    expect(empty.ids.every((id) => listRuntimePlugins('python').find((p) => p.id === id)?.required)).toBe(
      true,
    );
  });

  it('builds npm install lines for pm2', () => {
    const { lines, ids } = buildRuntimePluginScriptLines('node', ['pm2', 'yarn']);
    expect(ids).toEqual(expect.arrayContaining(['pm2', 'yarn']));
    expect(lines.join('\n')).toMatch(/npm install -g/);
    expect(lines.join('\n')).toMatch(/pm2/);
  });

  it('dto for each kind', () => {
    for (const kind of ['node', 'python', 'go', 'rust', 'java', 'kotlin', 'bun'] as const) {
      const dto = runtimePluginsCatalogDto(kind);
      expect(dto.kind).toBe(kind);
      expect(Array.isArray(dto.plugins)).toBe(true);
    }
  });
});

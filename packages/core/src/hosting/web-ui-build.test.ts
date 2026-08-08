import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import { findWebUiIndex, ensureWebUiBuilt, findMonorepoRoot } from './web-ui-build.js';

describe('web-ui-build', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });

  it('findWebUiIndex sees dataDir/web', () => {
    const data = join(tmpdir(), `ysk-webui-${Date.now()}`);
    mkdirSync(join(data, 'web'), { recursive: true });
    dirs.push(data);
    writeFileSync(join(data, 'web', 'index.html'), '<html></html>');
    const f = findWebUiIndex(data, tmpdir());
    expect(f?.path).toContain('index.html');
  });

  it('ensureWebUiBuilt copies monorepo dist into dataDir/web', async () => {
    const root = join(tmpdir(), `ysk-mono-${Date.now()}`);
    const data = join(tmpdir(), `ysk-data-${Date.now()}`);
    dirs.push(root, data);
    mkdirSync(join(root, 'apps/web'), { recursive: true });
    mkdirSync(join(root, 'apps/web/dist'), { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    writeFileSync(join(root, 'apps/web/package.json'), '{"name":"@ysk/web"}');
    writeFileSync(join(root, 'apps/web/dist/index.html'), '<html>ui</html>');
    mkdirSync(data, { recursive: true });

    const r = await ensureWebUiBuilt({ dataDir: data, cwd: root });
    expect(r.ok).toBe(true);
    expect(findWebUiIndex(data, tmpdir())?.path).toContain(`${data}/web/index.html`);
  });

  it('findMonorepoRoot finds workspace', () => {
    const root = join(tmpdir(), `ysk-mono2-${Date.now()}`);
    dirs.push(root);
    mkdirSync(join(root, 'apps/web'), { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(join(root, 'apps/web/package.json'), '{}');
    expect(findMonorepoRoot(join(root, 'apps/web'))).toBe(root);
  });
});

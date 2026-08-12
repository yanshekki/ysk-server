import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import {
  findWebUiIndex,
  ensureWebUiBuilt,
  findMonorepoRoot,
  assessWebUiFix,
  webUiIndexCandidates,
} from './web-ui-build.js';

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

  it('webUiIndexCandidates includes dataDir and cwd package paths', () => {
    const data = join(tmpdir(), `ysk-webui-cand-${Date.now()}`);
    const list = webUiIndexCandidates(data, '/tmp');
    expect(list.some((p) => p.includes(`${data}/web/index.html`) || p.endsWith('web/index.html'))).toBe(
      true,
    );
  });

  it('ensureWebUiBuilt copies monorepo dist into dataDir/web', async () => {
    const root = join(tmpdir(), `ysk-mono-${Date.now()}`);
    const data = join(tmpdir(), `ysk-data-${Date.now()}`);
    dirs.push(root, data);
    mkdirSync(join(root, 'apps/web'), { recursive: true });
    mkdirSync(join(root, 'apps/web/dist'), { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    writeFileSync(join(root, 'apps/web/package.json'), '{"name":"@yanshekki/web"}');
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

  it('assessWebUiFix: ready when SPA present; no auto-fix', () => {
    const data = join(tmpdir(), `ysk-assess-ready-${Date.now()}`);
    mkdirSync(join(data, 'web'), { recursive: true });
    dirs.push(data);
    writeFileSync(join(data, 'web', 'index.html'), '<html></html>');
    const a = assessWebUiFix(data, tmpdir());
    expect(a.ready).toBe(true);
    expect(a.canAutoFix).toBe(false);
  });

  it('assessWebUiFix: monorepo → canAutoFix', () => {
    const root = join(tmpdir(), `ysk-assess-mono-${Date.now()}`);
    const data = join(tmpdir(), `ysk-assess-data-${Date.now()}`);
    dirs.push(root, data);
    mkdirSync(join(root, 'apps/web'), { recursive: true });
    mkdirSync(data, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(join(root, 'apps/web/package.json'), '{}');
    const a = assessWebUiFix(data, root);
    expect(a.ready).toBe(false);
    expect(a.canAutoFix).toBe(true);
    expect(a.monorepo).toBe(root);
  });

  it('assessWebUiFix / ensureWebUiBuilt: no monorepo → honest fail', async () => {
    const data = join(tmpdir(), `ysk-assess-empty-${Date.now()}`);
    const empty = join(tmpdir(), `ysk-empty-cwd-${Date.now()}`);
    dirs.push(data, empty);
    mkdirSync(data, { recursive: true });
    mkdirSync(empty, { recursive: true });
    const a = assessWebUiFix(data, empty);
    expect(a.ready).toBe(false);
    expect(a.canAutoFix).toBe(false);
    expect(a.reasonCodes).toContain('NO_MONOREPO');

    const r = await ensureWebUiBuilt({ dataDir: data, cwd: empty });
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('NO_MONOREPO');
    expect(r.notes.some((n) => /Manual:|YSK_WEB_ROOT|no monorepo/i.test(n))).toBe(true);
  });
});

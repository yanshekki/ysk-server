import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadNginxSettings,
  saveNginxSettings,
  renderNginxGlobalSnippet,
} from './nginx-settings.js';

describe('nginx-settings', () => {
  it('saves and renders snippet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-set-'));
    const s = saveNginxSettings(dir, { gzip: false, clientMaxBody: '50m' });
    expect(s.gzip).toBe(false);
    expect(s.clientMaxBody).toBe('50m');
    expect(loadNginxSettings(dir).clientMaxBody).toBe('50m');
    const snip = renderNginxGlobalSnippet(s);
    expect(snip).toContain('client_max_body_size 50m');
    expect(snip).toContain('gzip off');
    expect(readFileSync(join(dir, 'nginx', 'conf.d', 'ysk-http-defaults.conf'), 'utf8')).toContain(
      'server_tokens',
    );
    rmSync(dir, { recursive: true, force: true });
  });
});

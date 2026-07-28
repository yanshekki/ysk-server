import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureWpConfig } from './wordpress-setup.js';

describe('wordpress setup', () => {
  it('writes wp-config from sample with salts and DB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wp-'));
    const doc = join(dir, 'public');
    mkdirSync(doc, { recursive: true });
    writeFileSync(
      join(doc, 'wp-config-sample.php'),
      `<?php
define('DB_NAME', 'database_name_here');
define('DB_USER', 'username_here');
define('DB_PASSWORD', 'password_here');
define('DB_HOST', 'localhost');
define('AUTH_KEY', 'put your unique phrase here');
define('SECURE_AUTH_KEY', 'put your unique phrase here');
$table_prefix = 'wp_';
/* That's all, stop editing! */
`,
      'utf8',
    );
    try {
      const r = ensureWpConfig({
        docRoot: doc,
        dbName: 'mydb',
        dbUser: 'myuser',
        dbPassword: 's3cret',
        dbHost: '127.0.0.1',
      });
      expect(r.written).toBe(true);
      expect(existsSync(join(doc, 'wp-config.php'))).toBe(true);
      const body = readFileSync(join(doc, 'wp-config.php'), 'utf8');
      expect(body).toContain("define('DB_NAME', 'mydb')");
      expect(body).toContain("define('DB_USER', 'myuser')");
      expect(body).toContain("define('DB_PASSWORD', 's3cret')");
      expect(body).not.toContain('put your unique phrase here');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

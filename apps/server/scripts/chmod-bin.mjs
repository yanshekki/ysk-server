import { chmodSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const cli = join(dir, '..', 'dist', 'cli.js');
if (existsSync(cli)) {
  chmodSync(cli, 0o755);
}

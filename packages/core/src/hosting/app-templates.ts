/**
 * One-click application templates (Spec §4.10).
 * Scaffolds real files under project home; optional deploy after.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';

export type AppTemplateId = 'node-starter' | 'static-site' | 'wordpress-php';

export interface AppTemplateMeta {
  id: AppTemplateId;
  name: string;
  description: string;
  runtime: 'node' | 'php' | 'static';
  runtimeVersion: string;
}

export const APP_TEMPLATES: AppTemplateMeta[] = [
  {
    id: 'node-starter',
    name: 'Node.js Starter',
    description: 'Minimal HTTP server with /health and static public/',
    runtime: 'node',
    runtimeVersion: '20',
  },
  {
    id: 'static-site',
    name: 'Static Site',
    description: 'index.html + assets for nginx static or simple server',
    runtime: 'static',
    runtimeVersion: '1',
  },
  {
    id: 'wordpress-php',
    name: 'WordPress (PHP skeleton)',
    description: 'PHP docroot + wp-config sample + install plan (download WordPress separately)',
    runtime: 'php',
    runtimeVersion: '8.2',
  },
];

export function listAppTemplates(): AppTemplateMeta[] {
  return APP_TEMPLATES.map((t) => ({ ...t }));
}

export function getAppTemplate(id: string): AppTemplateMeta {
  const t = APP_TEMPLATES.find((x) => x.id === id);
  if (!t) {
    throw new YskError(ErrorCodes.VALIDATION, `Unknown template: ${id}`, {
      httpStatus: 400,
      details: { known: APP_TEMPLATES.map((x) => x.id) },
    });
  }
  return t;
}

export interface ScaffoldResult {
  ok: boolean;
  templateId: AppTemplateId;
  written: string[];
  notes: string[];
  entry?: string;
  docRoot?: string;
}

/**
 * Write template files into project home (app/ or app/public).
 * Does not overwrite non-empty custom trees unless force.
 */
export function scaffoldAppTemplate(input: {
  templateId: string;
  homeDir: string;
  projectName: string;
  domain?: string;
  force?: boolean;
}): ScaffoldResult {
  const meta = getAppTemplate(input.templateId);
  const notes: string[] = [`Template ${meta.id}: ${meta.name}`];
  const written: string[] = [];
  const appDir = join(input.homeDir, 'app');
  mkdirSync(appDir, { recursive: true });

  if (meta.id === 'node-starter') {
    const entry = 'server.js';
    const entryPath = join(appDir, entry);
    if (existsSync(entryPath) && !input.force) {
      notes.push(`${entry} exists — skipped (pass force to overwrite)`);
    } else {
      writeFileSync(
        entryPath,
        `// YSK node-starter — ${input.projectName}
const http = require('http');
const fs = require('fs');
const path = require('path');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const publicDir = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/health' || url === '/') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('ok ' + port + ' ' + url);
    return;
  }
  const file = path.join(publicDir, url === '/' ? 'index.html' : url.replace(/^\\//, ''));
  if (file.startsWith(publicDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.statusCode = 200;
    res.end(fs.readFileSync(file));
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});
server.listen(port, host, () => {
  process.stdout.write('ysk node-starter on ' + host + ':' + port + '\\n');
});
`,
        'utf8',
      );
      written.push(entryPath);
    }
    const pub = join(appDir, 'public');
    mkdirSync(pub, { recursive: true });
    const idx = join(pub, 'index.html');
    if (!existsSync(idx) || input.force) {
      writeFileSync(
        idx,
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(input.projectName)}</title></head>
<body><h1>${escapeHtml(input.projectName)}</h1><p>YSK Node Starter</p></body></html>\n`,
        'utf8',
      );
      written.push(idx);
    }
    const pkg = join(appDir, 'package.json');
    if (!existsSync(pkg) || input.force) {
      writeFileSync(
        pkg,
        JSON.stringify(
          {
            name: slug(input.projectName),
            version: '1.0.0',
            private: true,
            main: 'server.js',
            scripts: { start: 'node server.js' },
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
      written.push(pkg);
    }
    return { ok: true, templateId: meta.id, written, notes, entry };
  }

  if (meta.id === 'static-site') {
    const pub = join(appDir, 'public');
    mkdirSync(join(pub, 'assets'), { recursive: true });
    const idx = join(pub, 'index.html');
    writeFileSync(
      idx,
      `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.projectName)}</title>
  <link rel="stylesheet" href="/assets/site.css" />
</head>
<body>
  <main>
    <h1>${escapeHtml(input.projectName)}</h1>
    <p>Static site scaffolded by YSK Server.</p>
  </main>
</body>
</html>
`,
      'utf8',
    );
    const css = join(pub, 'assets', 'site.css');
    writeFileSync(
      css,
      `body{font-family:system-ui,sans-serif;margin:2rem;background:#0b1220;color:#e8eefc}
main{max-width:40rem}h1{color:#3b82f6}
`,
      'utf8',
    );
    written.push(idx, css);
    notes.push('Serve public/ via nginx root or static deploy');
    return { ok: true, templateId: meta.id, written, notes, docRoot: pub };
  }

  // wordpress-php
  const docRoot = join(appDir, 'public');
  mkdirSync(docRoot, { recursive: true });
  const indexPhp = join(docRoot, 'index.php');
  writeFileSync(
    indexPhp,
    `<?php
// YSK WordPress skeleton — replace with full WordPress after download
header('Content-Type: text/plain; charset=utf-8');
echo "YSK PHP OK — WordPress not installed yet\\n";
echo "Run: curl -sL https://wordpress.org/latest.tar.gz | tar xz -C " . __DIR__ . " --strip-components=1\\n";
`,
    'utf8',
  );
  written.push(indexPhp);
  const wpConfig = join(docRoot, 'wp-config-sample-ysk.php');
  writeFileSync(
    wpConfig,
    `<?php
/**
 * YSK sample — copy to wp-config.php after WordPress extract.
 * DB credentials should come from env or YSK secrets store.
 */
define('DB_NAME', getenv('WP_DB_NAME') ?: 'wordpress');
define('DB_USER', getenv('WP_DB_USER') ?: 'wpuser');
define('DB_PASSWORD', getenv('WP_DB_PASSWORD') ?: 'change-me');
define('DB_HOST', getenv('WP_DB_HOST') ?: '127.0.0.1');
define('DB_CHARSET', 'utf8mb4');
\$table_prefix = 'wp_';
if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');
// require_once ABSPATH . 'wp-settings.php';
`,
    'utf8',
  );
  written.push(wpConfig);
  const planPath = join(appDir, 'WORDPRESS_INSTALL.txt');
  writeFileSync(
    planPath,
    [
      `WordPress install plan for ${input.projectName}`,
      input.domain ? `Domain: ${input.domain}` : '',
      '1. Provision MySQL: POST /api/v1/hosting/db/mysql-provision',
      '2. Download core into app/public:',
      '   curl -sL https://wordpress.org/latest.tar.gz | tar xz -C app/public --strip-components=1',
      '3. Copy wp-config-sample-ysk.php → wp-config.php and set DB_*',
      '4. Deploy PHP: POST /api/v1/projects/:id/deploy-php',
      '5. Publish Nginx + SSL',
      '',
    ]
      .filter(Boolean)
      .join('\n'),
    'utf8',
  );
  written.push(planPath);
  notes.push('WordPress core not downloaded (network opt-in) — follow WORDPRESS_INSTALL.txt');
  return {
    ok: true,
    templateId: meta.id,
    written,
    notes,
    docRoot,
  };
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'app';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Read package.json name if present (for tests) */
export function readAppPackageName(homeDir: string): string | null {
  const p = join(homeDir, 'app', 'package.json');
  if (!existsSync(p)) return null;
  try {
    return (JSON.parse(readFileSync(p, 'utf8')) as { name?: string }).name ?? null;
  } catch {
    return null;
  }
}

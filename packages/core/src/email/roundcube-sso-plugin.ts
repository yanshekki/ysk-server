import { tl } from '@ysk-server/shared';
/**
 * Roundcube SSO plugin skeleton + optional system symlink into Roundcube plugins/.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';

export function writeRoundcubeSsoPlugin(input: {
  dataDir: string;
  /** panel public base URL for token consume */
  panelBaseUrl: string;
}): { ok: boolean; written: string[]; notes: string[]; pluginDir: string } {
  const dir = join(input.dataDir, 'email', 'webmail', 'plugins', 'ysk_sso');
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const notes: string[] = [];

  const php = `<?php
/**
 * YSK Webmail SSO — Roundcube auto-login plugin
 * Panel: POST /api/v1/email/webmail/sso with password → user opens ?_ysk_sso=TOKEN
 * Plugin consumes token and calls $RCMAIL->login(email, password) when password present.
 */
class ysk_sso extends rcube_plugin {
  public $task = 'login|mail';
  function init() {
    $this->add_hook('startup', array($this, 'startup'));
  }
  function startup($args) {
    $token = isset($_GET['_ysk_sso']) ? $_GET['_ysk_sso'] : null;
    if (!$token) return $args;
    $url = ${JSON.stringify(input.panelBaseUrl.replace(/\/$/, '') + '/api/v1/email/webmail/sso/consume')};
    $ctx = stream_context_create(array(
      'http' => array(
        'method' => 'POST',
        'header' => "Content-Type: application/json\\r\\n",
        'content' => json_encode(array('token' => $token)),
        'timeout' => 8,
        'ignore_errors' => true,
      ),
    ));
    $raw = @file_get_contents($url, false, $ctx);
    $data = $raw ? json_decode($raw, true) : null;
    if (empty($data['ok']) || empty($data['email'])) {
      error_log('YSK SSO consume failed');
      return $args;
    }
    $email = $data['email'];
    $pass = isset($data['password']) ? $data['password'] : null;
    $rcmail = rcube::get_instance();
    if ($pass && method_exists($rcmail, 'login')) {
      $auth = $rcmail->login($email, $pass, $rcmail->config->get('default_host'), true);
      if ($auth) {
        $rcmail->session->set('user_id', $rcmail->get_user_id());
        $rcmail->session->set('password', $rcmail->encrypt($pass));
        header('Location: ./?_task=mail');
        exit;
      }
      error_log('YSK SSO login() failed for ' . $email);
    } else {
      // No password — prefill username on login form
      $_SESSION['ysk_sso_user'] = $email;
      error_log('YSK SSO verified ' . $email . ' (no password for auto-login)');
    }
    return $args;
  }
}
`;
  const path = join(dir, 'ysk_sso.php');
  writeFileSync(path, php, 'utf8');
  written.push(path);

  const conf = join(dir, 'config.inc.php.dist');
  writeFileSync(
    conf,
    "<?php\n// $config['ysk_sso_panel'] = 'https://panel.example.com';\n",
    'utf8',
  );
  written.push(conf);

  const readme = join(dir, 'README.txt');
  writeFileSync(
    readme,
    [
      'YSK Roundcube SSO plugin skeleton',
      `Panel consume: ${input.panelBaseUrl}/api/v1/email/webmail/sso/consume`,
      tl('notes.auto.n0469'),
      '',
    ].join('\n'),
    'utf8',
  );
  written.push(readme);
  notes.push(tl('notes.auto.t0071', { v0: (dir) }));
  notes.push(tl('notes.auto.n1233'));
  if (!existsSync(path)) {
    return { ok: false, written, notes: [...notes, tl('notes.auto.n0676')], pluginDir: dir };
  }
  return { ok: true, written, notes, pluginDir: dir };
}

/** Common Roundcube plugin directory candidates */
export const ROUNDCUBE_PLUGIN_CANDIDATES = [
  '/var/www/ysk-webmail',
  '/var/lib/roundcube/plugins',
  '/usr/share/roundcube/plugins',
  '/var/www/roundcube/plugins',
  '/opt/roundcube/plugins',
];

/**
 * Symlink managed plugin into a Roundcube plugins/ tree (needs EXECUTE+root for system paths).
 */
export async function enableRoundcubeSsoPlugin(input: {
  dataDir: string;
  host: HostExecutor;
  panelBaseUrl: string;
  /** Explicit Roundcube plugins dir; auto-detect if omitted */
  roundcubePluginsDir?: string;
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  symlink?: string;
  blocked?: boolean;
  blockMessage?: string;
  apply_status: 'written' | 'applied' | 'blocked';
}> {
  const base = writeRoundcubeSsoPlugin({
    dataDir: input.dataDir,
    panelBaseUrl: input.panelBaseUrl,
  });
  const notes = [...base.notes];
  const written = [...base.written];

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      notes: [...notes, tl('notes.auto.n1138')],
      written,
      blocked: true,
      blockMessage: tl('notes.auto.n1557'),
      apply_status: 'blocked',
    };
  }

  let pluginsDir = input.roundcubePluginsDir?.trim();
  if (!pluginsDir) {
    // Probe candidates: either .../plugins or .../webmail.domain/public/plugins
    for (const c of ROUNDCUBE_PLUGIN_CANDIDATES) {
      if (existsSync(c) && c.endsWith('plugins')) {
        pluginsDir = c;
        break;
      }
      if (existsSync(c)) {
        // ysk-webmail multi-domain
        try {
          for (const name of readdirSync(c)) {
            const p = join(c, name, 'plugins');
            if (existsSync(p)) {
              pluginsDir = p;
              break;
            }
            const p2 = join(c, name, 'public', 'plugins');
            if (existsSync(p2)) {
              pluginsDir = p2;
              break;
            }
          }
        } catch {
          /* skip */
        }
        if (pluginsDir) break;
      }
    }
  }

  // Also check managed download path under dataDir
  if (!pluginsDir) {
    const managed = join(input.dataDir, 'email', 'webmail');
    if (existsSync(managed)) {
      try {
        for (const name of readdirSync(managed)) {
          const p = join(managed, name, 'public', 'plugins');
          if (existsSync(p)) {
            pluginsDir = p;
            break;
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  if (!pluginsDir) {
    notes.push(
      tl('notes.auto.n0847'),
    );
    return {
      ok: true,
      notes,
      written,
      apply_status: 'written',
    };
  }

  const linkPath = join(pluginsDir, 'ysk_sso');
  const r = await input.host.runCommand(
    [
      'bash',
      '-c',
      `mkdir -p ${JSON.stringify(pluginsDir)} && ln -sfn ${JSON.stringify(base.pluginDir)} ${JSON.stringify(linkPath)} 2>&1`,
    ],
    { timeoutMs: 10_000 },
  );
  if (r.exitCode !== 0) {
    notes.push(tl('notes.auto.t0072', { v0: ((r.stderr || r.stdout).slice(0, 200)) }));
    return {
      ok: false,
      notes,
      written,
      apply_status: 'written',
    };
  }
  notes.push(tl('notes.auto.t0073', { v0: (linkPath), v1: (base.pluginDir) }));
  written.push(linkPath);

  // Auto-enable in config.inc.php near this plugins tree
  const configResult = await ensureRoundcubePluginInConfig({
    host: input.host,
    pluginsDir,
    pluginName: 'ysk_sso',
  });
  notes.push(...configResult.notes);
  written.push(...configResult.written);

  // Symlink succeeded; config may be partial — ok reflects full apply only
  notes.push(
    configResult.ok
      ? tl('notes.auto.n1209')
      : tl('notes.auto.n1221'),
  );
  return {
    ok: configResult.ok,
    notes,
    written,
    symlink: linkPath,
    apply_status: configResult.ok ? 'applied' : 'written',
  };
}

/**
 * Ensure $config['plugins'][] = 'ysk_sso' in Roundcube config.inc.php
 */
export async function ensureRoundcubePluginInConfig(input: {
  host: HostExecutor;
  pluginsDir: string;
  pluginName: string;
}): Promise<{ ok: boolean; notes: string[]; written: string[] }> {
  const notes: string[] = [];
  const written: string[] = [];
  const name = input.pluginName.replace(/[^a-z0-9_]/gi, '');
  // pluginsDir = .../plugins → parent may hold config or config/
  const candidates = [
    join(input.pluginsDir, '..', 'config', 'config.inc.php'),
    join(input.pluginsDir, '..', 'config.inc.php'),
    join(input.pluginsDir, '..', '..', 'config', 'config.inc.php'),
    '/etc/roundcube/config.inc.php',
    '/var/lib/roundcube/config/config.inc.php',
  ];

  let configPath: string | undefined;
  for (const c of candidates) {
    if (existsSync(c)) {
      configPath = c;
      break;
    }
  }
  if (!configPath) {
    // probe via host find (best-effort)
    const find = await input.host.runCommand(
      [
        'bash',
        '-c',
        `ls ${JSON.stringify(join(input.pluginsDir, '..', 'config', 'config.inc.php'))} 2>/dev/null; ls /etc/roundcube/config.inc.php 2>/dev/null; true`,
      ],
      { timeoutMs: 5_000 },
    );
    const line = find.stdout.trim().split('\n').find((l) => l.includes('config.inc.php'));
    if (line && existsSync(line.trim())) configPath = line.trim();
  }

  if (!configPath) {
    notes.push(tl('notes.auto.n0850'));
    return { ok: false, notes, written };
  }

  // Idempotent append via bash (works even if path only on remote fs via host)
  const snippet = `$config['plugins'][] = '${name}'; // YSK`;
  const script = `
set -e
CFG=${JSON.stringify(configPath)}
if grep -q "plugins'].*${name}" "$CFG" 2>/dev/null || grep -q "plugins\\]\\[\\].*${name}" "$CFG" 2>/dev/null || grep -q "'${name}'" "$CFG" 2>/dev/null; then
  echo ALREADY
  exit 0
fi
# Prefer inserting after plugins array if present
if grep -q "\\$config\\['plugins'\\]" "$CFG" 2>/dev/null; then
  printf '\\n// YSK auto-enable\\n%s\\n' ${JSON.stringify(snippet)} >> "$CFG"
  echo APPENDED_AFTER_PLUGINS
else
  printf '\\n// YSK auto-enable SSO plugin\\n%s\\n' ${JSON.stringify(snippet)} >> "$CFG"
  echo APPENDED_EOF
fi
`;
  const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 10_000 });
  const out = (r.stdout || '').trim();
  if (r.exitCode !== 0) {
    notes.push(tl('notes.auto.t0074', { v0: ((r.stderr || r.stdout).slice(0, 200)) }));
    return { ok: false, notes, written };
  }
  if (out.includes('ALREADY')) {
    notes.push(tl('notes.auto.t0075', { v0: (name), v1: (configPath) }));
  } else {
    notes.push(tl('notes.auto.t0076', { v0: (configPath), v1: (snippet) }));
    written.push(configPath);
  }
  return { ok: true, notes, written };
}


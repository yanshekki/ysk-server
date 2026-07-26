/**
 * Roundcube SSO plugin skeleton written under dataDir — not auto-installed into system Roundcube.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function writeRoundcubeSsoPlugin(input: {
  dataDir: string;
  /** panel public base URL for token consume */
  panelBaseUrl: string;
}): { ok: boolean; written: string[]; notes: string[] } {
  const dir = join(input.dataDir, 'email', 'webmail', 'plugins', 'ysk_sso');
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const notes: string[] = [];

  const php = `<?php
/**
 * YSK Webmail SSO — Roundcube plugin skeleton
 * 1) Enable in Roundcube config: $config['plugins'][] = 'ysk_sso';
 * 2) Symlink this dir into Roundcube plugins/
 * 3) Panel issues token via POST /api/v1/email/webmail/sso
 * 4) User hits ?_ysk_sso=<token> — plugin exchanges at panel consume URL
 */
class ysk_sso extends rcube_plugin {
  public $task = 'login|mail';
  function init() {
    $this->add_hook('startup', array($this, 'startup'));
  }
  function startup($args) {
    $token = $_GET['_ysk_sso'] ?? null;
    if (!$token) return $args;
    $url = ${JSON.stringify(input.panelBaseUrl.replace(/\/$/, '') + '/api/v1/email/webmail/sso/consume')};
    $ctx = stream_context_create([
      'http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\\r\\n",
        'content' => json_encode(['token' => $token]),
        'timeout' => 5,
      ],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    $data = $raw ? json_decode($raw, true) : null;
    if (!empty($data['ok']) && !empty($data['email'])) {
      // Operator must wire auto-login carefully; skeleton only logs intent
      error_log('YSK SSO ok for ' . $data['email']);
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
      'written ≠ Roundcube 已載入 — 需 symlink 到 roundcube/plugins 並啟用',
      '',
    ].join('\n'),
    'utf8',
  );
  written.push(readme);
  notes.push(`已寫入 plugin 骨架 ${dir}`);
  notes.push('狀態：written（非已上線 SSO）');
  if (!existsSync(path)) {
    return { ok: false, written, notes: [...notes, '寫入失敗'] };
  }
  return { ok: true, written, notes };
}

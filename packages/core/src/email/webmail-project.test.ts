import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  buildRoundcubeConfigInc,
  defaultImapHostForWebmail,
  defaultWebmailHostname,
  defaultWebmailProjectName,
  ensureRoundcubeRuntime,
  ensureSnappyMailAdminBootstrap,
  installWebmailIntoProject,
  installYskSsoIntoRoundcube,
  isRoundcubeDocRoot,
  isSnappyMailDocRoot,
  isWebmailPublicHtmlStub,
  normalizeWebmailTool,
  resolveRoundcubePackageRoot,
  resolveRoundcubeWebRoot,
  resolveWebmailMailEndpoints,
  stripWebmailHostnamePrefix,
  ROUNDCUBE_VERSION,
} from './webmail-project.js';
import { LocalHostExecutor } from '../host/executor.js';

describe('webmail-project helpers', () => {
  it('normalizes tool ids', () => {
    expect(normalizeWebmailTool('roundcube')).toBe('roundcube');
    expect(normalizeWebmailTool('snappymail')).toBe('snappymail');
    expect(normalizeWebmailTool('snappy')).toBe('snappymail');
    expect(normalizeWebmailTool('rainloop')).toBe('snappymail');
    expect(normalizeWebmailTool('')).toBe('roundcube');
  });

  it('default project names and hostnames', () => {
    expect(defaultWebmailProjectName('roundcube', '')).toBe('ysk-webmail');
    expect(defaultWebmailProjectName('roundcube', 'example.com')).toBe(
      'roundcube-example-com',
    );
    expect(defaultWebmailProjectName('snappymail', 'webmail.foo.test')).toBe(
      'snappymail-foo-test',
    );
    expect(defaultWebmailHostname('example.com')).toBe('webmail.example.com');
    expect(defaultWebmailHostname('webmail.example.com')).toBe('webmail.example.com');
  });

  it('derives IMAP host from webmail or apex', () => {
    expect(defaultImapHostForWebmail('webmail.example.com')).toBe('mail.example.com');
    expect(defaultImapHostForWebmail('example.com')).toBe('mail.example.com');
    expect(defaultImapHostForWebmail('mail.example.com')).toBe('mail.example.com');
  });

  it('Roundcube config is managed with SSL IMAP and submission SMTP', () => {
    const cfg = buildRoundcubeConfigInc({
      desKey: 'abcdefghijklmnopqrstuvwx',
      imapHost: 'mail.example.com',
      smtpHost: 'mail.example.com',
      dbPath: '/var/lib/ysk/roundcube.db',
      forceHttps: true,
      plugins: ['archive', 'ysk_sso'],
    });
    expect(cfg).toContain("default_host'] = 'ssl://mail.example.com'");
    expect(cfg).toContain("smtp_server'] = 'tls://mail.example.com'");
    expect(cfg).toContain("smtp_port'] = 587");
    expect(cfg).toContain("enable_installer'] = false");
    expect(cfg).toContain('product_name');
    expect(cfg).toContain('ysk_sso');
    expect(cfg).toContain('sqlite:');
    expect(cfg).toContain("force_https'] = false");
    expect(cfg).toContain("use_https'] = true");
    expect(cfg).toContain('abcdefghijklmnopqrstuvwx');
  });

  it('detects Roundcube vs php-hello doc roots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-detect-'));
    try {
      writeFileSync(join(dir, 'index.php'), '<?php echo "YSK PHP OK\\n";\n', 'utf8');
      expect(isRoundcubeDocRoot(dir)).toBe(false);
      mkdirSync(join(dir, 'program', 'include'), { recursive: true });
      writeFileSync(join(dir, 'program', 'include', 'iniset.php'), '<?php\n', 'utf8');
      writeFileSync(join(dir, 'index.php'), '<?php /* ROUNDCUBE */\n', 'utf8');
      expect(isRoundcubeDocRoot(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects Roundcube package-root stub; accepts public_html web root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-rc17-'));
    try {
      mkdirSync(join(dir, 'program', 'include'), { recursive: true });
      mkdirSync(join(dir, 'public_html'), { recursive: true });
      writeFileSync(join(dir, 'program', 'include', 'iniset.php'), '<?php\n', 'utf8');
      writeFileSync(
        join(dir, 'index.php'),
        "<?php\n\nexit('Please, configure your HTTP server to point to the /public_html directory (with fallback to /public_html/index.php.');\n",
        'utf8',
      );
      writeFileSync(
        join(dir, 'public_html', 'index.php'),
        "<?php\nrequire_once __DIR__ . '/../program/include/iniset.php';\n",
        'utf8',
      );
      expect(isWebmailPublicHtmlStub(dir)).toBe(true);
      expect(isRoundcubeDocRoot(dir)).toBe(false);
      expect(isRoundcubeDocRoot(join(dir, 'public_html'))).toBe(true);
      expect(resolveRoundcubeWebRoot(dir)).toBe(join(dir, 'public_html'));
      expect(resolveRoundcubePackageRoot(join(dir, 'public_html'))).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never treats public_html php-hello as Roundcube even if parent has program/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-hello-ph-'));
    try {
      mkdirSync(join(dir, 'program', 'include'), { recursive: true });
      mkdirSync(join(dir, 'public_html'), { recursive: true });
      writeFileSync(join(dir, 'program', 'include', 'iniset.php'), '<?php\n', 'utf8');
      writeFileSync(join(dir, 'public_html', 'index.php'), '<?php echo "YSK PHP OK\\n";\n', 'utf8');
      expect(isRoundcubeDocRoot(join(dir, 'public_html'))).toBe(false);
      expect(resolveRoundcubeWebRoot(dir)).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects SnappyMail public_html package stub as doc root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-stub-'));
    try {
      writeFileSync(
        join(dir, 'index.php'),
        'Please, configure your HTTP server to point to the /public_html directory (with fallback to /public_html/index.php).\n',
        'utf8',
      );
      expect(isWebmailPublicHtmlStub(dir)).toBe(true);
      expect(isSnappyMailDocRoot(dir)).toBe(false);
      mkdirSync(join(dir, 'snappymail'), { recursive: true });
      writeFileSync(join(dir, 'index.php'), '<?php // snappymail app\n', 'utf8');
      writeFileSync(join(dir, '_include.php'), '<?php\n', 'utf8');
      expect(isWebmailPublicHtmlStub(dir)).toBe(false);
      expect(isSnappyMailDocRoot(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('installSnappy prefers public_html over package-root stub (no network)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-sm-'));
    try {
      const homeDir = join(dir, 'home');
      const docRoot = join(homeDir, 'app', 'public');
      mkdirSync(docRoot, { recursive: true });
      // Package layout: root stub + real app under public_html
      const build = join(dir, 'build');
      mkdirSync(join(build, 'public_html', 'snappymail'), { recursive: true });
      writeFileSync(
        join(build, 'index.php'),
        'Please, configure your HTTP server to point to the /public_html directory.\n',
        'utf8',
      );
      writeFileSync(join(build, 'public_html', 'index.php'), '<?php // snappymail\n', 'utf8');
      writeFileSync(join(build, 'public_html', '_include.php'), '<?php\n', 'utf8');
      const tgz = join(dir, 'sm.tgz');
      execFileSync('tar', ['-czf', tgz, '-C', build, '.']);

      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
      const orig = host.runCommand.bind(host);
      host.runCommand = async (argv, opts) => {
        const script = argv[0] === 'bash' && argv[1] === '-c' ? String(argv[2] ?? '') : '';
        if (script.includes('curl') && script.includes('snappy')) {
          const patched = script
            .split('\n')
            .map((line) => {
              if (line.includes('curl') && line.includes('-o')) {
                const m = line.match(/-o\s+(\S+)/);
                const dest = m ? m[1].replace(/^"|"$/g, '') : '';
                if (dest) return `cp ${JSON.stringify(tgz)} ${JSON.stringify(dest)}`;
              }
              return line;
            })
            .join('\n');
          return orig(['bash', '-c', patched], opts);
        }
        return orig(argv, opts);
      };

      const r = await installWebmailIntoProject({
        host,
        homeDir,
        docRoot,
        tool: 'snappymail',
        domain: 'webmail.example.com',
        download: true,
      });
      expect(r.ok, r.notes.join('\n')).toBe(true);
      expect(isWebmailPublicHtmlStub(docRoot)).toBe(false);
      expect(isSnappyMailDocRoot(docRoot)).toBe(true);
      expect(readFileSync(join(docRoot, 'index.php'), 'utf8')).toMatch(/snappymail/i);
      expect(existsSync(join(docRoot, '_include.php'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Regression: extract under docRoot + shopt dotglob wipe deleted INNER before cp
   * (user saw: cp: cannot stat '.../roundcubemail-*').
   * Real bash path with local tarball — no network.
   */
  it('installRoundcube extract outside docRoot survives wipe (no network)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-extract-'));
    try {
      const homeDir = join(dir, 'home');
      const docRoot = join(homeDir, 'app', 'public');
      const build = join(dir, 'build', `roundcubemail-${ROUNDCUBE_VERSION}`);
      mkdirSync(join(build, 'program', 'include'), { recursive: true });
      mkdirSync(join(build, 'config'), { recursive: true });
      mkdirSync(docRoot, { recursive: true });
      writeFileSync(join(build, 'index.php'), '<?php /* ROUNDCUBE */\n', 'utf8');
      writeFileSync(join(build, 'program', 'include', 'iniset.php'), '<?php\n', 'utf8');
      writeFileSync(join(docRoot, 'index.php'), '<?php echo "YSK PHP OK\\n";\n', 'utf8');
      const tgz = join(dir, 'rc.tgz');
      execFileSync('tar', ['-czf', tgz, '-C', join(dir, 'build'), `roundcubemail-${ROUNDCUBE_VERSION}`]);

      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
      const orig = host.runCommand.bind(host);
      host.runCommand = async (argv, opts) => {
        const script = argv[0] === 'bash' && argv[1] === '-c' ? String(argv[2] ?? '') : '';
        if (script.includes('curl') && script.includes('roundcube')) {
          // Skip network: drop curl line, inject local tarball as the download target
          const patched = script
            .split('\n')
            .map((line) => {
              if (line.includes('curl') && line.includes('-o')) {
                const m = line.match(/-o\s+(\S+)/);
                const dest = m ? m[1].replace(/^"|"$/g, '') : '';
                if (dest) {
                  return `cp ${JSON.stringify(tgz)} ${JSON.stringify(dest)}`;
                }
              }
              return line;
            })
            .join('\n');
          return orig(['bash', '-c', patched], opts);
        }
        return orig(argv, opts);
      };

      const r = await installWebmailIntoProject({
        host,
        homeDir,
        docRoot,
        tool: 'roundcube',
        domain: 'webmail.example.com',
        download: true,
        installSsoPlugin: false,
      });
      expect(r.ok, r.notes.join('\n')).toBe(true);
      expect(isRoundcubeDocRoot(docRoot)).toBe(true);
      expect(readFileSync(join(docRoot, 'index.php'), 'utf8')).toMatch(/ROUNDCUBE/i);
      expect(existsSync(join(docRoot, '.rc-extract'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes SSO plugin and force_https runtime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-'));
    try {
      const sso = installYskSsoIntoRoundcube(dir, 'https://panel.example');
      expect(existsSync(join(sso.pluginDir, 'ysk_sso.php'))).toBe(true);
      const rt = ensureRoundcubeRuntime(dir, 'mail.ex.com', 'mail.ex.com', {
        forceHttps: true,
        installSsoPlugin: true,
        panelBaseUrl: 'https://panel.example',
      });
      expect(rt.written.some((p) => p.includes('config.inc.php'))).toBe(true);
      const cfg = readFileSync(join(dir, 'config', 'config.inc.php'), 'utf8');
      expect(cfg).toContain('ysk_sso');
      expect(cfg).toContain("force_https'] = false");
      expect(cfg).toContain("use_https'] = true");
      expect(cfg).toContain('proxy_whitelist');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds SnappyMail admin once password', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sm-'));
    try {
      const r = ensureSnappyMailAdminBootstrap(dir, 'mail.ex.com', 'mail.ex.com', 'TestPass99aa', {
        mailDomain: 'ex.com',
      });
      expect(r.adminPassword).toBe('TestPass99aa');
      expect(existsSync(join(dir, 'ysk-snappy-admin.php'))).toBe(true);
      const domainJson = join(dir, 'data', '_data_', '_default_', 'domains', 'ex.com.json');
      expect(existsSync(domainJson)).toBe(true);
      const body = JSON.parse(readFileSync(domainJson, 'utf8')) as {
        IMAP: { shortLogin: boolean; port: number; host: string };
      };
      expect(body.IMAP.shortLogin).toBe(false);
      expect(body.IMAP.port).toBe(993);
      expect(body.IMAP.host).toBe('127.0.0.1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves mail endpoints from webmail2 host and mailDomain', () => {
    expect(stripWebmailHostnamePrefix('webmail2.demo.ysk.hk')).toBe('demo.ysk.hk');
    expect(defaultImapHostForWebmail('webmail2.demo.ysk.hk')).toBe('mail.demo.ysk.hk');
    expect(defaultImapHostForWebmail('demo.ysk.hk')).toBe('mail.demo.ysk.hk');
    const ep = resolveWebmailMailEndpoints({
      webmailDomain: 'webmail.demo.ysk.hk',
      mailDomain: 'demo.ysk.hk',
    });
    expect(ep.mailDomain).toBe('demo.ysk.hk');
    expect(ep.imapHost).toBe('mail.demo.ysk.hk');
    expect(ep.smtpHost).toBe('mail.demo.ysk.hk');
  });
});

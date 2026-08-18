import { describe, expect, it } from 'vitest';
import {
  classifyOpsNote,
  humanizeOperatorMessage,
  humanizeOperatorNote,
  isOperatorNoise,
  looksLikeBlockedMessage,
  presentOpsNotes,
  sanitizeOperatorNotes,
} from './operator-messages';

describe('isOperatorNoise', () => {
  it('flags empty and shell/env homework', () => {
    expect(isOperatorNoise('')).toBe(true);
    expect(isOperatorNoise('  ')).toBe(true);
    expect(isOperatorNoise('Set YSK_EXECUTE=1')).toBe(true);
    expect(isOperatorNoise('sudo systemctl restart nginx')).toBe(true);
    expect(isOperatorNoise('apt-get install foo')).toBe(true);
    expect(isOperatorNoise('CREATE USER foo')).toBe(true);
    expect(
      isOperatorNoise(
        '建置：export CARGO_HOME=/usr/local/ysk/rust/cargo RUSTUP_TOOLCHAIN=1.97.1 CARGO_BIN=... cargo build --release',
      ),
    ).toBe(true);
  });

  it('allows clean operator notes', () => {
    expect(isOperatorNoise('Certificate issued for example.com')).toBe(false);
    expect(isOperatorNoise('Project deployed')).toBe(false);
    expect(isOperatorNoise('建置完成')).toBe(false);
  });
});

describe('classifyOpsNote', () => {
  it('keeps PowerDNS bind / journal lines as primary', () => {
    expect(
      classifyOpsNote(
        'PowerDNS 無法綁定 0.0.0.0:53（埠被佔用），多與 systemd-resolved 衝突。',
      ),
    ).toBe('primary');
    expect(
      classifyOpsNote("Unable to bind UDP socket to '0.0.0.0:53': Address already in use"),
    ).toBe('primary');
  });
});

describe('presentOpsNotes', () => {
  it('keeps short human steps in summary and hides cargo shell', () => {
    const { summary, technical } = presentOpsNotes([
      '隔離模式：以專案用戶 ysks_x 建置與啟動',
      '運行時：rust · 埠 3201 · entry ./target/release/my_rust',
      '建置：export CARGO_HOME=/x RUSTUP_HOME=/y PATH=/z cargo +1.97.1 build --release',
      '建置完成',
      '健康檢查通過（4ms）',
      '已重載 Nginx',
      'systemd: is-active=inactive, MainPID=0',
      'Managed configs live in /var/lib/ysk-server/nginx/conf.d',
    ]);
    expect(summary.some((s) => /建置完成|Build completed/i.test(s))).toBe(true);
    expect(summary.every((s) => !/export CARGO_HOME|CARGO_BIN/i.test(s))).toBe(true);
    expect(summary.every((s) => !/Managed configs live/i.test(s))).toBe(true);
    // technical may hold unit diagnostics if humanized
    expect(Array.isArray(technical)).toBe(true);
  });

  it('puts bind-conflict on the visible summary', () => {
    const { summary } = presentOpsNotes([
      '沒有運行中的 named／bind9／pdns 單元',
      'PowerDNS 無法綁定 0.0.0.0:53（埠被佔用），多與 systemd-resolved 衝突。',
      "Unable to bind UDP socket to '0.0.0.0:53': Address already in use",
    ]);
    expect(summary.some((s) => /0\.0\.0\.0:53|埠被佔用|Unable to bind/i.test(s))).toBe(true);
  });
});

describe('looksLikeBlockedMessage', () => {
  it('detects execute / root / permission signals', () => {
    expect(looksLikeBlockedMessage('YSK_NEED_EXECUTE')).toBe(true);
    expect(looksLikeBlockedMessage('requiresExecute is true')).toBe(true);
    expect(looksLikeBlockedMessage('Host execute is off')).toBe(true);
    expect(looksLikeBlockedMessage('permission denied')).toBe(true);
    expect(looksLikeBlockedMessage('need root')).toBe(true);
    expect(looksLikeBlockedMessage('requires root')).toBe(true);
    expect(looksLikeBlockedMessage('未開啟系統變更權限')).toBe(true);
    expect(looksLikeBlockedMessage('真正推送需 執行 + 系統變更權限已開啟')).toBe(false);
    expect(looksLikeBlockedMessage('all good')).toBe(false);
  });
});

describe('humanizeOperatorNote', () => {
  it('returns null for empty', () => {
    expect(humanizeOperatorNote('')).toBeNull();
    expect(humanizeOperatorNote('   ')).toBeNull();
  });

  it('maps SSH publickey deny to auth, not panel EXECUTE-off', () => {
    const n = humanizeOperatorNote('Permission denied (publickey,password).');
    expect(n).not.toMatch(/無法在管理面板完成此操作|伺服器未開啟系統變更權限/);
  });

  it('does not treat dry-run “needs execute to apply” as execute-off', () => {
    const n = humanizeOperatorNote('真正推送需 執行 + 系統變更權限已開啟');
    expect(n).not.toMatch(/伺服器未開啟系統變更權限|無法在管理面板完成此操作/);
  });

  it('maps execute / root blocks to localized ops keys', () => {
    const exec = humanizeOperatorNote('YSK_NEED_EXECUTE required');
    expect(exec).toBeTruthy();
    expect(exec).not.toMatch(/YSK_NEED_EXECUTE/);
    // zh-HK or en localization of block
    expect(exec!.toLowerCase()).toMatch(
      /execute|host|panel|off|enable|系統變更|执行|權限|权限|開啟|开启|blocked|封鎖|封锁/i,
    );

    const root = humanizeOperatorNote('need root privileges');
    expect(root).toBeTruthy();
    expect(root!.toLowerCase()).toMatch(/root|管理員|管理员|root/);
  });

  it('maps written ≠ applied honesty', () => {
    const n = humanizeOperatorNote('written ≠ applied on host');
    expect(n).toBeTruthy();
    // common.writtenOnly — zh-HK or en
    expect(n).toMatch(/written|panel|host|applied|已寫入|已写入|未套用|未应用|管理/i);
  });

  it('maps bare success/failed tokens', () => {
    expect(humanizeOperatorNote('ok')).toBeTruthy();
    expect(humanizeOperatorNote('failed')).toBeTruthy();
  });

  it('maps YSK_EXECUTE shell slogans to blocked message (not raw shell)', () => {
    const n = humanizeOperatorNote('export YSK_EXECUTE=1 && bash install.sh');
    // Prefer localized block over leaking shell homework
    expect(n).toBeTruthy();
    expect(n).not.toMatch(/bash install|export /i);
  });

  it('drops pure SQL noise as null', () => {
    expect(humanizeOperatorNote('CREATE USER foo WITH PASSWORD')).toBeNull();
  });

  it('passes through already-localized free text', () => {
    expect(humanizeOperatorNote('Certificate renewed')).toBe('Certificate renewed');
  });

  it('does not flatten bind-in-use journal to generic EADDRINUSE', () => {
    const n = humanizeOperatorNote(
      "Unable to bind UDP socket to '0.0.0.0:53': Address already in use",
    );
    expect(n).toMatch(/0\.0\.0\.0:53|Unable to bind/i);
    expect(n).not.toBe('EADDRINUSE');
    expect(n).not.toMatch(/^失敗$|^failed$/i);
  });
});

describe('sanitizeOperatorNotes', () => {
  it('filters noise, humanizes, and dedupes', () => {
    const out = sanitizeOperatorNotes([
      'YSK_NEED_EXECUTE',
      'export YSK_EXECUTE=1',
      'YSK_NEED_EXECUTE',
      'Certificate issued',
    ]);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.some((n) => /certificate/i.test(n))).toBe(true);
    expect(out.every((n) => !/export YSK_EXECUTE/.test(n))).toBe(true);
  });

  it('handles null/empty', () => {
    expect(sanitizeOperatorNotes(null)).toEqual([]);
    expect(sanitizeOperatorNotes(undefined)).toEqual([]);
    expect(sanitizeOperatorNotes([])).toEqual([]);
  });
});

describe('humanizeOperatorMessage', () => {
  it('falls back when empty', () => {
    const m = humanizeOperatorMessage(null);
    expect(m.length).toBeGreaterThan(0);
    expect(humanizeOperatorMessage('')).toBe(m);
  });

  it('humanizes known phrases', () => {
    const m = humanizeOperatorMessage('Host execute is off');
    expect(m).not.toBe('Host execute is off');
    expect(m.length).toBeGreaterThan(0);
  });
});

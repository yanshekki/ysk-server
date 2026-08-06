/**
 * Unit tests for pure helpers exported to raise function coverage.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import {
  formatTtl,
  typeTone,
  typeLabel,
  formatValue,
  keysInDb,
} from './features/RedisPage';
import { parsePorts } from './features/FirewallPage';
import { enabledLabel, actionLabel, toneFor } from './features/ServicesPage';
import { applyLabel } from './EmailPage';
import { statusLabel as ftpsStatusLabel } from './features/FtpsServicePage';
import {
  taskTone,
  statusLabel as aiStatusLabel,
  isTerminal,
  canApprove,
  canCancel,
  pipelinePhase,
  stepCount,
} from './AiPage';
import { statusBadge } from './features/SslPage';
import {
  formatBytes as sysFormatBytes,
  formatUptime as sysFormatUptime,
  memTone,
} from './SystemPage';
import { riskTone, riskLabel, isHighRisk, relTime as updRelTime } from './UpdatesPage';
import { formatBytes as filesFormatBytes, iconFor, joinPath } from './FilesPage';
import {
  enabledLabel as unitEnabledLabel,
  activeTone,
  activeLabel,
  enabledTone,
} from './features/SystemdUnitPage';
import { applyModeLabel, displayValue } from './features/ServiceConsolePage';
import { formatBytes as logsFormatBytes, groupLabel } from './features/LogsPage';
import {
  projectCommandPresets,
  defaultCommandForProject,
  isAutoCommand,
} from './features/CronPage';
import { levelMeta, presetWhen } from './features/ProtectionPage';
import {
  catLabel,
  levelTone,
  levelLabel,
  severityLabel,
} from './features/ReadinessPage';
import { serviceLabel } from './features/SqlEnginePage';
import {
  statusTone as clusterStatusTone,
  defaultKind,
  wizardTitle,
  ctaLabel,
} from '../features/db-service/DbClusterPanel';
import {
  statusLabel as ssh2faStatusLabel,
  statusTone as ssh2faStatusTone,
} from '../features/security/ssh/Ssh2faPanel';
import {
  processDeployHint,
  defaultEntryHint,
  envPlaceholder,
  checklistItems,
} from '../features/projects/ui/ProjectDeployTab';

const t = (k: string, o?: Record<string, unknown>) =>
  o ? `${k}:${JSON.stringify(o)}` : k;

describe('Redis helpers', () => {
  it('formatTtl / typeTone / typeLabel / formatValue / keysInDb', () => {
    expect(formatTtl(undefined, t)).toBe('—');
    expect(formatTtl(-2, t)).toBe('—');
    expect(formatTtl(-1, t)).toMatch(/Never|neverExpire/i);
    expect(formatTtl(30, t)).toMatch(/s|ttlSeconds/i);
    expect(formatTtl(120, t)).toMatch(/min|ttlMinutes/i);
    expect(formatTtl(7200, t)).toMatch(/h|ttlHours/i);
    expect(formatTtl(200_000, t)).toMatch(/d|ttlDays/i);

    expect(typeTone('string')).toBe('ok');
    expect(typeTone('hash')).toBe('info');
    expect(typeTone('list')).toBe('warn');
    expect(typeTone('zset')).toBe('neutral');
    expect(typeTone(undefined)).toBe('neutral');

    expect(typeLabel('string', t)).toMatch(/typeString|String/);
    expect(typeLabel('unknown', t)).toBe('unknown');
    expect(typeLabel(undefined, t)).toBe('—');

    expect(formatValue({ key: 'k', type: 'string', value: 'hi' } as never)).toBe('hi');
    expect(formatValue({ key: 'k', type: 'hash', value: { a: 1 } } as never)).toContain('a');

    expect(keysInDb(null, 0)).toBe(0);
    expect(
      keysInDb({ keyspace: [{ db: 0, keys: 3 }, { db: 2, keys: 9 }] } as never, 2),
    ).toBe(9);
    expect(keysInDb({ keyspace: [] } as never, 1)).toBe(0);
  });
});

describe('Firewall parsePorts', () => {
  it('parses lists, ranges, dedupes, caps', () => {
    expect(parsePorts('')).toEqual([]);
    expect(parsePorts('80,443')).toEqual([80, 443]);
    expect(parsePorts('30000:30002')).toEqual([30000, 30001, 30002]);
    expect(parsePorts('80 443 bad 0 99999')).toEqual([80, 443]);
    expect(parsePorts('5:3')).toEqual([3, 4, 5]);
    const wide = parsePorts('1:100');
    expect(wide.length).toBe(100);
    // FTPS PASV band must fit (was capped at 40 → LIST timeout on high ports)
    const pasv = parsePorts('21,30000:30100');
    expect(pasv).toContain(21);
    expect(pasv).toContain(30000);
    expect(pasv).toContain(30100);
    expect(pasv.length).toBe(102);
    expect(parsePorts('1:300').length).toBeLessThanOrEqual(200);
  });
});

describe('Services helpers', () => {
  it('enabledLabel / actionLabel / toneFor', () => {
    expect(enabledLabel('enabled', t as never)).toMatch(/enabledBoot/);
    expect(enabledLabel('disabled', t as never)).toMatch(/common.no|no/i);
    expect(enabledLabel('static', t as never)).toBe('static');
    expect(enabledLabel('indirect', t as never)).toBe('indirect');
    expect(enabledLabel('', t as never)).toMatch(/noneSelected|common/);

    for (const a of ['start', 'stop', 'restart', 'reload'] as const) {
      expect(actionLabel(a, t as never)).toContain(a);
    }

    expect(toneFor('active', true)).toBe('ok');
    expect(toneFor('inactive', true)).toBe('warn');
    expect(toneFor('failed', true)).toBe('danger');
    expect(toneFor('not-found', false)).toBe('danger');
    expect(toneFor('activating', true)).toBe('neutral');
  });
});

describe('Email / FTPS / SSL helpers', () => {
  it('applyLabel branches', () => {
    expect(applyLabel('applied', t).tone).toBe('ok');
    expect(applyLabel('written', t).tone).toBe('info');
    expect(applyLabel('failed', t).tone).toBe('warn');
    expect(applyLabel(undefined, t).tone).toBe('neutral');
    expect(applyLabel('DRAFT', t).tone).toBe('neutral');
  });

  it('ftps statusLabel', () => {
    expect(ftpsStatusLabel(null, t).tone).toBe('neutral');
    expect(ftpsStatusLabel({ installed: false } as never, t).tone).toBe('danger');
    expect(ftpsStatusLabel({ installed: true, active: 'active' } as never, t).tone).toBe(
      'ok',
    );
    expect(
      ftpsStatusLabel({ installed: true, active: 'inactive' } as never, t).tone,
    ).toBe('warn');
    expect(
      ftpsStatusLabel({ installed: true, active: 'activating' } as never, t).tone,
    ).toBe('warn');
  });

  it('ssl statusBadge variants', () => {
    for (const [status, files] of [
      ['uploaded', false],
      ['issued', false],
      ['planned', false],
      ['failed', false],
      ['missing', false],
      ['applied', true],
      ['applied', false],
      ['other', false],
      ['', true],
    ] as const) {
      const { container } = render(statusBadge(status, files, t));
      expect(container.textContent).toBeTruthy();
    }
  });
});

describe('AiPage helpers', () => {
  it('tone / terminal / approve / pipeline / steps', () => {
    for (const s of [
      'completed',
      'done',
      'executed',
      'failed',
      'error',
      'rejected',
      'pending',
      'planned',
      'running',
      'approved',
      'cancelled',
      'other',
    ]) {
      expect(taskTone(s)).toBeTruthy();
      expect(aiStatusLabel(s, t as never)).toBeTruthy();
      expect(typeof isTerminal(s)).toBe('boolean');
      expect(typeof canApprove(s)).toBe('boolean');
      expect(typeof canCancel(s)).toBe('boolean');
      expect([0, 1, 2, 3]).toContain(pipelinePhase(s));
    }
    expect(isTerminal('completed')).toBe(true);
    expect(canApprove('pending')).toBe(true);
    expect(canCancel('running')).toBe(true);
    expect(pipelinePhase('done')).toBe(3);
    expect(pipelinePhase('running')).toBe(2);
    expect(
      stepCount({
        steps: [
          { status: 'done' },
          { status: 'executed' },
          { status: 'pending' },
        ],
      } as never),
    ).toEqual({ done: 2, total: 3 });
  });
});

describe('System / Updates / Files helpers', () => {
  it('SystemPage formatBytes / uptime / memTone', () => {
    expect(sysFormatBytes(undefined)).toBe('—');
    expect(sysFormatBytes(100)).toBe('100 B');
    expect(sysFormatBytes(2048)).toMatch(/KB/);
    expect(sysFormatBytes(3 * 1024 * 1024)).toMatch(/MB/);
    expect(sysFormatUptime(undefined)).toBe('—');
    expect(sysFormatUptime(Number.NaN)).toBe('—');
    expect(sysFormatUptime(45)).toMatch(/m/);
    expect(sysFormatUptime(3700)).toMatch(/h/);
    expect(sysFormatUptime(90_000)).toMatch(/d/);
    expect(memTone(undefined)).toBe('neutral');
    expect(memTone(0.5)).toBe('ok');
    expect(memTone(0.8)).toBe('warn');
    expect(memTone(0.95)).toBe('danger');
  });

  it('Updates risk / relTime', () => {
    expect(riskTone('critical')).toBe('danger');
    expect(riskTone('high')).toBe('danger');
    expect(riskTone('medium')).toBe('warn');
    expect(riskTone('low')).toBe('ok');
    expect(riskTone('x')).toBe('neutral');
    for (const r of ['critical', 'high', 'medium', 'low', undefined]) {
      expect(riskLabel(r, t)).toBeTruthy();
    }
    expect(isHighRisk({ risk: 'high' } as never)).toBe(true);
    expect(isHighRisk({ risk: 'low', requiresApproval: true } as never)).toBe(true);
    expect(isHighRisk({ risk: 'low' } as never)).toBe(false);
    expect(updRelTime(null, t)).toBe('—');
    expect(updRelTime('bad', t)).toBeTruthy();
    expect(updRelTime(new Date().toISOString(), t)).toMatch(/just|sec|ago|now|updates/i);
    expect(updRelTime(new Date(Date.now() - 120_000).toISOString(), t)).toMatch(
      /min|ago|updates/i,
    );
    expect(updRelTime(new Date(Date.now() - 7200_000).toISOString(), t)).toMatch(
      /hour|ago|updates/i,
    );
    expect(updRelTime(new Date(Date.now() - 3 * 86400_000).toISOString(), t)).toBeTruthy();
  });

  it('Files formatBytes / iconFor / joinPath', () => {
    expect(filesFormatBytes(-1)).toBe('—');
    expect(filesFormatBytes(Number.NaN)).toBe('—');
    expect(filesFormatBytes(10)).toBe('10 B');
    expect(filesFormatBytes(2048)).toMatch(/KB/);
    expect(filesFormatBytes(3 * 1024 * 1024)).toMatch(/MB/);
    expect(filesFormatBytes(2 * 1024 ** 3)).toMatch(/GB/);
    expect(iconFor({ type: 'dir' } as never)).toBe('📁');
    expect(iconFor({ type: 'file', mime: 'image/png' } as never)).toBe('🖼');
    expect(iconFor({ type: 'file', mime: 'application/pdf' } as never)).toBe('📄');
    expect(iconFor({ type: 'file', mime: 'video/mp4' } as never)).toBe('🎬');
    expect(iconFor({ type: 'file', mime: 'audio/mpeg' } as never)).toBe('🎵');
    expect(iconFor({ type: 'file', mime: 'text/plain' } as never)).toBe('📝');
    expect(iconFor({ type: 'file', mime: 'application/json' } as never)).toBe('📝');
    expect(iconFor({ type: 'file', mime: 'application/octet-stream' } as never)).toBe(
      '📎',
    );
    expect(joinPath('.', 'a')).toBe('a');
    expect(joinPath('', 'a')).toBe('a');
    expect(joinPath('docs/', 'x')).toBe('docs/x');
    expect(joinPath('docs', 'x')).toBe('docs/x');
  });
});

describe('Systemd / ServiceConsole / Logs helpers', () => {
  it('systemd labels/tones', () => {
    expect(unitEnabledLabel(undefined)).toBe('—');
    expect(unitEnabledLabel('enabled')).toBeTruthy();
    expect(unitEnabledLabel('disabled')).toBeTruthy();
    expect(unitEnabledLabel('not-found')).toBeTruthy();
    expect(unitEnabledLabel('static')).toBe('static');
    expect(unitEnabledLabel('indirect')).toBe('indirect');
    expect(unitEnabledLabel('other')).toBe('other');
    for (const a of [
      'active',
      'activating',
      'reloading',
      'failed',
      'inactive',
      'not-found',
      'weird',
      '',
    ]) {
      expect(activeTone(a)).toBeTruthy();
      expect(activeLabel(a)).toBeTruthy();
    }
    expect(enabledTone('enabled')).toBe('ok');
    expect(enabledTone('disabled')).toBe('warn');
    expect(enabledTone('static')).toBe('neutral');
  });

  it('service console labels', () => {
    expect(applyModeLabel('runtime')).toBeTruthy();
    expect(applyModeLabel('reload')).toBeTruthy();
    expect(applyModeLabel('restart')).toBeTruthy();
    expect(applyModeLabel('other')).toBe('other');
    expect(displayValue(undefined)).toBe('');
    expect(displayValue('')).toBe('');
    expect(displayValue('x')).toBe('x');
  });

  it('logs formatBytes / groupLabel', () => {
    expect(logsFormatBytes(undefined)).toBe('—');
    expect(logsFormatBytes(10)).toBe('10 B');
    expect(logsFormatBytes(2048)).toMatch(/KB/);
    expect(logsFormatBytes(3 * 1024 * 1024)).toMatch(/MB/);
    expect(groupLabel('proj:myapp')).toBe('myapp');
    expect(groupLabel('system')).toBeTruthy();
    expect(groupLabel('web')).toBe('Web');
    expect(groupLabel('mail')).toBeTruthy();
    expect(groupLabel('security')).toBeTruthy();
    expect(groupLabel('app')).toBeTruthy();
    expect(groupLabel('other')).toBeTruthy();
    expect(groupLabel('journal')).toBeTruthy();
    expect(groupLabel('custom-x')).toBe('custom-x');
  });
});

describe('Cron project presets', () => {
  const base = { id: 'p1', name: 'app', homeDir: '/home/ysk/app1', runtime: 'php' as const };

  it('presets per runtime + auto detection', () => {
    for (const runtime of ['php', 'node', 'python', 'go', 'rust', 'static', 'other'] as const) {
      const p = { ...base, runtime: runtime as never };
      const presets = projectCommandPresets(p);
      expect(presets.length).toBeGreaterThan(0);
      expect(defaultCommandForProject(p)).toBeTruthy();
    }
    const php = { ...base, runtime: 'php' as const };
    const cmd = defaultCommandForProject(php);
    expect(isAutoCommand(cmd, [php])).toBe(true);
    expect(isAutoCommand('/usr/bin/true', [php])).toBe(true);
    expect(isAutoCommand('', [php])).toBe(true);
    expect(isAutoCommand('echo custom', [php])).toBe(false);
  });
});

describe('Protection / Readiness / SqlEngine helpers', () => {
  it('levelMeta / presetWhen', () => {
    for (const level of ['low', 'elevated', 'under_attack', 'critical'] as const) {
      const m = levelMeta(t, level as never);
      expect(m.label).toBeTruthy();
      expect(m.verb).toBeTruthy();
      expect(m.tone).toBeTruthy();
    }
    expect(presetWhen(t, 'daily')).toBeTruthy();
    expect(presetWhen(t, 'unknown_preset_xyz')).toBe('unknown_preset_xyz');
  });

  it('readiness labels', () => {
    expect(catLabel('security', t)).toBeTruthy();
    expect(catLabel('totally_unknown_cat', t)).toBe('totally_unknown_cat');
    expect(levelTone('ready')).toBe('ok');
    expect(levelTone('degraded')).toBe('warn');
    expect(levelTone('missing')).toBe('danger');
    expect(levelTone('unknown' as never)).toBe('neutral');
    for (const l of ['ready', 'degraded', 'missing', 'unknown'] as const) {
      expect(levelLabel(l as never, t)).toBeTruthy();
    }
    expect(severityLabel('critical', t)).toBeTruthy();
    expect(severityLabel('recommended', t)).toBeTruthy();
    expect(severityLabel('optional', t)).toBeTruthy();
    expect(severityLabel(undefined, t)).toBeNull();
    expect(severityLabel('x', t)).toBeNull();
  });

  it('sql serviceLabel', () => {
    expect(serviceLabel(null, t).tone).toBe('neutral');
    expect(serviceLabel({ serverInstalled: false } as never, t).tone).toBe('danger');
    expect(serviceLabel({ serverInstalled: true, active: 'active' } as never, t).tone).toBe(
      'ok',
    );
    expect(
      serviceLabel({ serverInstalled: true, active: 'inactive' } as never, t).tone,
    ).toBe('warn');
    expect(
      serviceLabel({ serverInstalled: true, active: 'degraded' } as never, t).tone,
    ).toBe('warn');
  });
});

describe('DbCluster / Ssh2fa / ProjectDeploy helpers', () => {
  it('cluster status/kind/title/cta', () => {
    for (const s of ['healthy', 'planned', 'draft', 'partial', 'failed', 'degraded', 'x']) {
      expect(clusterStatusTone(s)).toBeTruthy();
    }
    expect(defaultKind('mariadb')).toBe('mariadb-galera');
    expect(defaultKind('mysql')).toBe('mysql-replica');
    expect(defaultKind('postgres')).toBe('postgres-replica');
    expect(defaultKind('redis')).toBe('redis-replica');
    for (const k of [
      'mariadb-galera',
      'mysql-replica',
      'postgres-replica',
      'redis-sentinel',
      'redis-replica',
    ] as const) {
      expect(wizardTitle(k)).toBeTruthy();
      expect(ctaLabel(k)).toBeTruthy();
    }
  });

  it('ssh2fa status helpers', () => {
    for (const s of ['enrolled', 'confirmed', 'file_written', 'retired', 'error', 'other']) {
      expect(ssh2faStatusLabel(s, t)).toBeTruthy();
      expect(ssh2faStatusTone(s)).toBeTruthy();
    }
  });

  it('deploy tab hints', () => {
    for (const r of ['python', 'go', 'rust', 'node', 'php', 'static']) {
      expect(processDeployHint(r)).toBeTruthy();
      expect(defaultEntryHint(r)).toBeDefined();
      expect(envPlaceholder(r, false)).toBeTruthy();
      expect(envPlaceholder(r, true)).toContain('APP_ENV');
      expect(checklistItems(r).length).toBeGreaterThan(0);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { LocalHostExecutor } from '../host/executor.js';
import { activatingLooksStuck, probeAgentRuntime, renderAgentSystemdUnit } from './probe.js';

describe('agent probe', () => {
  it('probes catalog runtime without throw', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await probeAgentRuntime('openclaw', host);
    expect(r.kind).toBe('openclaw');
    expect(r.unitName).toBe('ysk-agent-openclaw.service');
    expect(r.installPlan.length).toBeGreaterThan(0);
    expect(['unknown', 'not_installed', 'stopped', 'running']).toContain(r.status);
  });

  it('renders fail-closed unit without binary (no silent placeholder)', () => {
    const u = renderAgentSystemdUnit({
      kind: 'hermes',
      installPath: '/opt/ysk-server/agents/hermes',
      nodePath: '/usr/bin/node',
    });
    expect(u).toContain('ysk-agent-hermes');
    expect(u).toContain('YSK_AGENT_KIND=hermes');
    expect(u).toMatch(/process\.exit\(1\)|refuse to run placeholder/);
    expect(u).not.toMatch(/setInterval/);
  });

  it('treats long activating or crash-loop as stuck', () => {
    const now = Date.parse('2026-08-18T08:00:00.000Z');
    expect(
      activatingLooksStuck(
        { ActiveEnterTimestampUSec: String((now - 6 * 60_000) * 1000) },
        now,
      ),
    ).toBe(true);
    expect(
      activatingLooksStuck(
        { ActiveEnterTimestampUSec: String((now - 30_000) * 1000) },
        now,
      ),
    ).toBe(false);
    expect(activatingLooksStuck({ NRestarts: '2' }, now)).toBe(true);
    expect(activatingLooksStuck({ SubState: 'auto-restart' }, now)).toBe(true);
  });

  it('renders real ExecStart when binaryPath provided', () => {
    const u = renderAgentSystemdUnit({
      kind: 'openclaw',
      installPath: '/opt/ysk-server/agents/openclaw',
      binaryPath: '/usr/bin/openclaw',
    });
    expect(u).toContain('ExecStart=/usr/bin/openclaw');
    expect(u).not.toMatch(/process\.exit\(1\)/);
  });
});

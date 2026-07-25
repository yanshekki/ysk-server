import { describe, expect, it } from 'vitest';
import { LocalHostExecutor } from '../host/executor.js';
import { probeAgentRuntime, renderAgentSystemdUnit } from './probe.js';

describe('agent probe', () => {
  it('probes catalog runtime without throw', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await probeAgentRuntime('openclaw', host);
    expect(r.kind).toBe('openclaw');
    expect(r.unitName).toBe('ysk-agent-openclaw.service');
    expect(r.installPlan.length).toBeGreaterThan(0);
    expect(['unknown', 'not_installed', 'stopped', 'running']).toContain(r.status);
  });

  it('renders systemd unit template', () => {
    const u = renderAgentSystemdUnit({
      kind: 'hermes',
      installPath: '/opt/ysk-server/agents/hermes',
      nodePath: '/usr/bin/node',
    });
    expect(u).toContain('ysk-agent-hermes');
    expect(u).toContain('YSK_AGENT_KIND=hermes');
  });
});

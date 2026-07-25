import { describe, expect, it } from 'vitest';
import { riskToOperationLevel, toolImpliedLevel } from './operation-level.js';

describe('operation-level', () => {
  it('maps risk tiers', () => {
    expect(riskToOperationLevel('low')).toBe('read');
    expect(riskToOperationLevel('medium')).toBe('write-low');
    expect(riskToOperationLevel('high')).toBe('write-high');
    expect(riskToOperationLevel('critical')).toBe('destructive');
  });

  it('implies levels from tool names', () => {
    expect(toolImpliedLevel('fs.read', 'high')).toBe('read');
    expect(toolImpliedLevel('sys.info', 'low')).toBe('read');
    expect(toolImpliedLevel('service.status', 'medium')).toBe('read');
    expect(toolImpliedLevel('fs.write', 'low')).toBe('write-low');
    expect(toolImpliedLevel('service.restart', 'high')).toBe('write-high');
    expect(toolImpliedLevel('firewall.flush', 'medium')).toBe('destructive');
  });
});

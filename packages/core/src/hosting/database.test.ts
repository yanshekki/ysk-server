import { describe, expect, it } from 'vitest';
import { planMysqlDatabase, planRedisBinding } from './database.js';

describe('database plans', () => {
  it('plans mysql database and user grants', () => {
    const plan = planMysqlDatabase({ dbName: 'appdb', username: 'appuser' });
    expect(plan.kind).toBe('mysql');
    expect(plan.commands.some((c) => c.includes('CREATE DATABASE'))).toBe(true);
    expect(plan.commands.some((c) => c.includes('GRANT'))).toBe(true);
  });

  it('plans redis binding with valid db index', () => {
    const plan = planRedisBinding({ projectId: 'p1', dbIndex: 3 });
    expect(plan.connectionHint?.db).toBe(3);
    expect(() => planRedisBinding({ projectId: 'p1', dbIndex: 99 })).toThrow();
  });
});

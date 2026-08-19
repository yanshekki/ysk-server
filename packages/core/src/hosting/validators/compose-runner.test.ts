import { describe, expect, it } from 'vitest';
import { composePsStatesFromStdout } from './compose-runner.js';

describe('composePsStatesFromStdout', () => {
  it('parses a compose v2.29 JSON array without wrapping it again', () => {
    const stdout = JSON.stringify([
      { Name: 'yskval-eth-sepolia-1-el-1', State: 'running', Status: 'Up 2 seconds' },
      { Name: 'yskval-eth-sepolia-1-cl-1', State: 'running', Status: 'Up 1 second' },
    ]);
    expect(composePsStatesFromStdout(stdout)).toEqual(['running', 'running']);
  });

  it('parses NDJSON / single object', () => {
    expect(composePsStatesFromStdout('{"State":"running"}\n{"State":"running"}')).toEqual([
      'running',
      'running',
    ]);
    expect(composePsStatesFromStdout('{"State":"running"}')).toEqual(['running']);
  });

  it('prefers Status Exited over a stale State', () => {
    expect(
      composePsStatesFromStdout(
        JSON.stringify([{ State: 'running', Status: 'Exited (1) 1 second ago' }]),
      ),
    ).toEqual(['exited']);
  });
});

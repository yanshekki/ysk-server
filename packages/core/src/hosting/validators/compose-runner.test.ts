import { describe, expect, it } from 'vitest';
import {
  composePsInfoFromStates,
  composePsInfoFromStdout,
  composePsStatesFromStdout,
  restartCountFromStatus,
} from './compose-runner.js';

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

describe('composePsInfoFromStates', () => {
  it('treats Created-only as created, not running or stopped', () => {
    expect(composePsInfoFromStates(['created'], true)).toEqual({
      running: false,
      restarting: false,
      exited: false,
      created: true,
      missing: false,
      restartCount: null,
      exitCode: null,
    });
  });

  it('treats no rows and no ids as missing', () => {
    expect(composePsInfoFromStates([], false).missing).toBe(true);
    expect(composePsInfoFromStates([], false).running).toBe(false);
  });

  it('treats restarting as restarting not running', () => {
    const info = composePsInfoFromStates(['restarting'], true);
    expect(info.restarting).toBe(true);
    expect(info.running).toBe(false);
  });

  it('reads restart count from Status', () => {
    expect(restartCountFromStatus('Restarting (1) 3 seconds ago')).toBe(1);
    expect(
      composePsInfoFromStdout(
        JSON.stringify([{ State: 'restarting', Status: 'Restarting (2) 3 seconds ago' }]),
      ),
    ).toMatchObject({ restarting: true, running: false, restartCount: 2 });
  });

  it('reads non-zero ExitCode including OOM 137', () => {
    expect(
      composePsInfoFromStdout(
        JSON.stringify([
          { State: 'exited', Status: 'Exited (137) 1 second ago', ExitCode: 137 },
        ]),
      ),
    ).toMatchObject({ exited: true, running: false, exitCode: 137 });
  });
});

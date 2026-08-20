import { describe, expect, it } from 'vitest';
import {
  applyComposeTimezone,
  composeProjectName,
  composePsInfoFromStates,
  composePsInfoFromStdout,
  composePsStatesFromStdout,
  hostTimezoneName,
  restartCountFromStatus,
  validatorIdFromContainerName,
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

describe('validatorIdFromContainerName', () => {
  it('matches compose project prefix and does not collapse 1 vs 10', () => {
    const ids = ['eth-hoodi-1', 'eth-hoodi-10', 'avax-fuji-1'];
    expect(validatorIdFromContainerName('yskval-eth-hoodi-1-el-1', ids)).toBe('eth-hoodi-1');
    expect(validatorIdFromContainerName('/yskval-eth-hoodi-10-cl-1', ids)).toBe('eth-hoodi-10');
    expect(validatorIdFromContainerName('yskval-avax-fuji-1-node-1', ids)).toBe('avax-fuji-1');
    expect(validatorIdFromContainerName('other', ids)).toBeNull();
    expect(composeProjectName('avax-fuji-1')).toBe('yskval-avax-fuji-1');
  });
});

describe('applyComposeTimezone', () => {
  it('injects TZ after restart so container logs follow the host zone', () => {
    const y = applyComposeTimezone(
      'services:\n  node:\n    restart: unless-stopped\n    volumes:\n      - /data:/data\n',
      'Asia/Hong_Kong',
    );
    expect(y).toContain('environment:');
    expect(y).toContain('TZ: Asia/Hong_Kong');
    expect(hostTimezoneName()).toMatch(/^[A-Za-z0-9/_+-]+$/);
  });
});

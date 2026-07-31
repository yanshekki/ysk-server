import { describe, expect, it } from 'vitest';
import { exitFromResult, exitFromError, printCliError } from './cli.js';
import { YskError, ErrorCodes } from '@ysk/shared';

describe('CLI exit mapping', () => {
  it('exitFromResult maps honesty shapes', () => {
    expect(exitFromResult({ ok: true })).toBe(0);
    expect(exitFromResult({ ok: false, blocked: true })).toBe(3);
    expect(exitFromResult({ ok: false, code: 'YSK_NOT_FOUND' })).toBe(4);
    expect(exitFromResult({ ok: false, code: 'YSK_VALIDATION' })).toBe(2);
    expect(exitFromResult({ ok: false, code: 'YSK_HOST_ERROR' })).toBe(5);
    expect(exitFromResult({ ok: false })).toBe(1);
    expect(exitFromResult({})).toBe(0);
  });

  it('exitFromError maps YskError codes', () => {
    expect(exitFromError(new YskError(ErrorCodes.VALIDATION, 'v', { httpStatus: 400 }))).toBe(2);
    expect(exitFromError(new YskError(ErrorCodes.CONFIG_INVALID, 'c', { httpStatus: 400 }))).toBe(2);
    expect(exitFromError(new YskError(ErrorCodes.NOT_FOUND, 'n', { httpStatus: 404 }))).toBe(4);
    expect(exitFromError(new YskError(ErrorCodes.FORBIDDEN, 'f', { httpStatus: 403 }))).toBe(3);
    expect(exitFromError(new YskError(ErrorCodes.INTERNAL, 'i', { httpStatus: 500 }))).toBe(1);
    expect(exitFromError(new Error('plain'))).toBe(1);
    expect(exitFromError('string')).toBe(1);
  });

  it('printCliError returns exit codes for json and text', () => {
    const logs: string[] = [];
    const errLogs: string[] = [];
    const ow = process.stdout.write.bind(process.stdout);
    const ew = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string | Uint8Array) => {
      logs.push(String(c));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((c: string | Uint8Array) => {
      errLogs.push(String(c));
      return true;
    }) as typeof process.stderr.write;
    try {
      const codeJson = printCliError(
        new YskError(ErrorCodes.NOT_FOUND, 'missing', { httpStatus: 404 }),
        true,
      );
      expect(codeJson).toBe(4);
      expect(logs.join('')).toMatch(/NOT_FOUND|missing|YSK_/);
      const codeText = printCliError(
        new YskError(ErrorCodes.VALIDATION, 'bad', { httpStatus: 400 }),
        false,
      );
      expect(codeText).toBe(2);
      expect(errLogs.join('').length + logs.join('').length).toBeGreaterThan(0);
      expect(printCliError(new Error('x'), false)).toBe(1);
    } finally {
      process.stdout.write = ow;
      process.stderr.write = ew;
    }
  });
});

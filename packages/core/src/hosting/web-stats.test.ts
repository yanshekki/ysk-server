import { describe, expect, it } from 'vitest';
import { parseAccessLogTail } from './web-stats.js';

describe('web-stats parseAccessLogTail', () => {
  it('parses combined-ish lines', () => {
    const content = [
      '1.2.3.4 - - [01/Jan/2026] "GET /index.html HTTP/1.1" 200 1234',
      '1.2.3.4 - - [01/Jan/2026] "GET /api HTTP/1.1" 404 10',
      '1.2.3.4 - - [01/Jan/2026] "POST /api HTTP/1.1" 500 99',
      'garbage line',
    ].join('\n');
    const r = parseAccessLogTail(content);
    expect(r.linesRead).toBe(4);
    expect(r.status2xx).toBe(1);
    expect(r.status4xx).toBe(1);
    expect(r.status5xx).toBe(1);
    expect(r.topPaths[0].path).toBeTruthy();
    expect(r.bytesHint).toBeGreaterThan(0);
    expect(parseAccessLogTail('').notes[0]).toMatch(/無可用/);
  });
});

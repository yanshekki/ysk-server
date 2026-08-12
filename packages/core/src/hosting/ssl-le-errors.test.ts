import { describe, expect, it } from 'vitest';
import {
  extractDomainFromLeOutput,
  explainLetsEncryptFailure,
  notesForLetsEncryptFailure,
} from './ssl-le-errors.js';

const NXDOMAIN_LOG = `
Certbot failed to authenticate some domains (authenticator: nginx). The Certificate Authority reported these problems:
  Domain: le-test.example.test
  Type:   dns
  Detail: DNS problem: NXDOMAIN looking up A for le-test.example.test - check that a DNS record exists for this domain; DNS problem: NXDOMAIN looking up AAAA for le-test.example.test
`;

describe('ssl-le-errors', () => {
  it('extracts domain from NXDOMAIN / challenge text', () => {
    expect(extractDomainFromLeOutput(NXDOMAIN_LOG)).toBe('le-test.example.test');
    expect(extractDomainFromLeOutput('Challenge failed for domain foo.example.com')).toBe(
      'foo.example.com',
    );
  });

  it('classifies NXDOMAIN with actionable summary', () => {
    const ex = explainLetsEncryptFailure(NXDOMAIN_LOG);
    expect(ex.kind).toBe('nxdomain');
    expect(ex.domain).toBe('le-test.example.test');
    expect(ex.summary.length).toBeGreaterThan(10);
    expect(ex.hint.length).toBeGreaterThan(10);
    // Should not be the useless "Saving debug log..." only
    expect(ex.summary).not.toMatch(/Saving debug log/i);
  });

  it('notesForLetsEncryptFailure puts human reason first', () => {
    const notes = notesForLetsEncryptFailure(NXDOMAIN_LOG);
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(notes[0]).toMatch(/le-test\.example\.test|NXDOMAIN|DNS|記錄|record/i);
  });

  it('classifies rate limit and connection-style errors', () => {
    expect(explainLetsEncryptFailure('too many certificates already issued').kind).toBe(
      'rate_limit',
    );
    expect(
      explainLetsEncryptFailure('Invalid response from http://x: Connection refused').kind,
    ).toBe('http01');
  });
});

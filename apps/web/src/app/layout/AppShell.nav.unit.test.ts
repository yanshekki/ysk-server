import { describe, expect, it } from 'vitest';
import { isNavActive } from './AppShell';

describe('isNavActive', () => {
  it('root and exact', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/', '/x')).toBe(false);
    expect(isNavActive('/ftp', '/ftp')).toBe(true);
  });
  it('nested without longer sibling', () => {
    // /projects/p1 under /projects — sibling /projects not matching longer
    expect(isNavActive('/projects', '/projects/p1')).toBe(true);
  });
  it('prefers longer sibling path', () => {
    // /ftp/service should not activate /ftp when /ftp/service is a nav path
    expect(isNavActive('/ftp', '/ftp/service')).toBe(false);
    expect(isNavActive('/ftp/service', '/ftp/service')).toBe(true);
    expect(isNavActive('/ftp/service', '/ftp/service/extra')).toBe(true);
  });
  it('unrelated', () => {
    expect(isNavActive('/dns', '/email')).toBe(false);
    expect(isNavActive('/a', '/ab')).toBe(false);
  });
});

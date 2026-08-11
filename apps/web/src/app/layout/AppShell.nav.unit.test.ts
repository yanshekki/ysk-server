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
    // mysql resource vs mysql/service — longer sibling wins
    expect(isNavActive('/databases/mysql', '/databases/mysql/service')).toBe(false);
    expect(isNavActive('/databases/mysql/service', '/databases/mysql/service')).toBe(
      true,
    );
    expect(
      isNavActive('/databases/mysql/service', '/databases/mysql/service/extra'),
    ).toBe(true);
    // FTP is a single nav entry — nested leftover path still highlights /ftp
    expect(isNavActive('/ftp', '/ftp/service')).toBe(true);
  });
  it('unrelated', () => {
    expect(isNavActive('/dns', '/email')).toBe(false);
    expect(isNavActive('/a', '/ab')).toBe(false);
  });
});

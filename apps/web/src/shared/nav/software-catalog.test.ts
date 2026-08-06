import { describe, expect, it } from 'vitest';
import {
  SOFTWARE_CARDS,
  SOFTWARE_TABS,
  cardsForTab,
  runtimeCards,
} from './software-catalog';

describe('software-catalog', () => {
  it('has six tabs including overview', () => {
    expect(SOFTWARE_TABS.map((t) => t.id)).toEqual([
      'overview',
      'runtimes',
      'databases',
      'edge',
      'mail-files',
      'host',
    ]);
  });

  it('covers runtimes from screenshots', () => {
    const ids = runtimeCards().map((c) => c.id);
    for (const id of ['node', 'php', 'python', 'go', 'rust', 'java', 'kotlin', 'bun']) {
      expect(ids).toContain(id);
    }
  });

  it('covers dns ssl nginx and databases', () => {
    const all = SOFTWARE_CARDS.map((c) => c.id);
    for (const id of [
      'dns',
      'cdn',
      'ssl',
      'nginx',
      'mysql',
      'mariadb',
      'postgres',
      'redis',
      'email',
      'files',
      'ftp',
    ]) {
      expect(all).toContain(id);
    }
  });

  it('cardsForTab filters; overview returns all', () => {
    expect(cardsForTab('runtimes').every((c) => c.tab === 'runtimes')).toBe(true);
    expect(cardsForTab('overview').length).toBe(SOFTWARE_CARDS.length);
  });

  it('every card has valid route path', () => {
    for (const c of SOFTWARE_CARDS) {
      expect(c.to.startsWith('/')).toBe(true);
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.navKey.length).toBeGreaterThan(0);
    }
  });
});

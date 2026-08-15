import { describe, expect, it } from 'vitest';
import { scrollTabListTo } from './Tabs';

describe('scrollTabListTo', () => {
  it('only adjusts horizontal scrollLeft', () => {
    const list = document.createElement('div');
    const tab = document.createElement('button');
    list.appendChild(tab);
    document.body.appendChild(list);
    list.getBoundingClientRect = () =>
      ({ left: 0, right: 100, top: 0, bottom: 40, width: 100, height: 40 }) as DOMRect;
    tab.getBoundingClientRect = () =>
      ({ left: 120, right: 200, top: 0, bottom: 40, width: 80, height: 40 }) as DOMRect;
    list.scrollLeft = 0;
    scrollTabListTo(list, tab);
    expect(list.scrollLeft).toBe(100);
    document.body.removeChild(list);
  });
});

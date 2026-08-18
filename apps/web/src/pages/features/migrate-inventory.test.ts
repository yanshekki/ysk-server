import { describe, expect, it } from 'vitest';
import {
  inventoryPillKind,
  isOrphanHomeWarning,
  otherInventoryWarnings,
  orphanHomeName,
} from './migrate-inventory';

const orphans = [
  '/home/ysk-server-aaa',
  '/home/ysk-server-bbb',
];

describe('isOrphanHomeWarning', () => {
  it('matches a warning that already embeds the leftover path', () => {
    expect(
      isOrphanHomeWarning('磁碟有孤立 主目錄（store 無對應）: /home/ysk-server-aaa', orphans),
    ).toBe(true);
  });

  it('matches leftover-home wording without listing every path', () => {
    expect(isOrphanHomeWarning('leftover project home not in the store', [])).toBe(true);
    expect(isOrphanHomeWarning('orphan home /tmp/x', [])).toBe(true);
  });

  it('keeps unrelated inventory warnings', () => {
    expect(isOrphanHomeWarning('rsync missing from PATH', orphans)).toBe(false);
    expect(isOrphanHomeWarning('ysk.json missing', orphans)).toBe(false);
  });
});

describe('otherInventoryWarnings', () => {
  it('drops leftover-home lines so the table is the only listing', () => {
    expect(
      otherInventoryWarnings(
        [
          '磁碟有孤立 主目錄（store 無對應）: /home/ysk-server-aaa',
          '磁碟有孤立 主目錄（store 無對應）: /home/ysk-server-bbb',
          'rsync missing from PATH',
        ],
        orphans,
      ),
    ).toEqual(['rsync missing from PATH']);
  });
});

describe('orphanHomeName', () => {
  it('uses the last path segment', () => {
    expect(orphanHomeName('/home/ysk-server-aaa')).toBe('ysk-server-aaa');
  });

  it('returns the original string when there is no segment', () => {
    expect(orphanHomeName('/')).toBe('/');
    expect(orphanHomeName('')).toBe('');
  });
});

describe('inventoryPillKind', () => {
  it('does not count leftover homes as generic warnings', () => {
    expect(
      inventoryPillKind({
        loading: false,
        hasInventory: true,
        otherWarningCount: 0,
        orphanCount: 13,
        hasError: false,
      }),
    ).toBe('orphans');
    expect(
      inventoryPillKind({
        loading: false,
        hasInventory: true,
        otherWarningCount: 2,
        orphanCount: 13,
        hasError: false,
      }),
    ).toBe('both');
    expect(
      inventoryPillKind({
        loading: false,
        hasInventory: true,
        otherWarningCount: 0,
        orphanCount: 0,
        hasError: false,
      }),
    ).toBe('ok');
  });
});

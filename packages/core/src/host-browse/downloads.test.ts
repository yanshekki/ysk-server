import { describe, expect, it } from 'vitest';
import {
  safeFilename,
  toPublicDownload,
  type BrowseDownload,
} from './downloads.js';
import { evaluateDownloadSafety } from './danger.js';

describe('downloads helpers', () => {
  it('sanitizes filenames', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('report (1).pdf')).toBe('report (1).pdf');
  });

  it('public view hides absPath', () => {
    const d: BrowseDownload = {
      id: 'a',
      sessionId: 's',
      userId: 'u',
      filename: 'a.pdf',
      sourceUrl: 'https://x/a.pdf',
      mime: 'application/pdf',
      size: 10,
      absPath: '/tmp/secret/a.pdf',
      status: 'completed',
      createdAt: new Date().toISOString(),
    };
    const p = toPublicDownload(d);
    expect((p as { absPath?: string }).absPath).toBeUndefined();
    expect(p.hasFile).toBe(false); // path may not exist on disk
    expect(p.filename).toBe('a.pdf');
  });

  it('blocks dangerous extensions by default', () => {
    expect(evaluateDownloadSafety({ filename: 'x.exe' }).action).toBe('block');
    expect(evaluateDownloadSafety({ filename: 'x.pdf' }).action).toBe('allow');
  });
});

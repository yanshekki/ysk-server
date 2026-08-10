/**
 * VNC service — status / settings skeleton (PR-A).
 * Account CRUD + sessions land in PR-B+.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tl } from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';
import {
  DEFAULT_VNC_SETTINGS,
  type VncOverviewStatus,
  type VncSettings,
  type VncStackStatus,
} from './types.js';

async function binExists(host: HostExecutor, bin: string): Promise<boolean> {
  const r = await host.runCommand(
    ['bash', '-c', `command -v ${bin} >/dev/null 2>&1 && echo ok || true`],
    { timeoutMs: 5_000 },
  );
  return r.stdout.trim().includes('ok');
}

async function anyBin(host: HostExecutor, bins: string[]): Promise<{
  installed: boolean;
  missing: string[];
  found: string[];
}> {
  const found: string[] = [];
  const missing: string[] = [];
  for (const b of bins) {
    if (await binExists(host, b)) found.push(b);
    else missing.push(b);
  }
  return { installed: found.length > 0, missing, found };
}

export class VncService {
  constructor(
    private readonly dataDir: string,
    private readonly host: HostExecutor,
  ) {}

  private root(): string {
    return join(this.dataDir, 'vnc');
  }

  private ensureDir(): void {
    mkdirSync(this.root(), { recursive: true });
  }

  private settingsPath(): string {
    return join(this.root(), 'settings.json');
  }

  private accountsPath(): string {
    return join(this.root(), 'accounts.json');
  }

  loadSettings(): VncSettings {
    this.ensureDir();
    const p = this.settingsPath();
    if (!existsSync(p)) return { ...DEFAULT_VNC_SETTINGS };
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<VncSettings>;
      return { ...DEFAULT_VNC_SETTINGS, ...raw };
    } catch {
      return { ...DEFAULT_VNC_SETTINGS };
    }
  }

  saveSettings(patch: Partial<VncSettings>): VncSettings {
    this.ensureDir();
    const next = { ...this.loadSettings(), ...patch };
    writeFileSync(this.settingsPath(), JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
  }

  private loadAccountCount(): number {
    this.ensureDir();
    const p = this.accountsPath();
    if (!existsSync(p)) return 0;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as { items?: unknown[] };
      return Array.isArray(raw.items) ? raw.items.length : 0;
    } catch {
      return 0;
    }
  }

  private async probeStacks(): Promise<VncStackStatus[]> {
    const tigervncBins = ['vncserver', 'Xvnc', 'x0vncserver'];
    const novncBins = ['websockify', 'novnc_proxy'];
    const xfceBins = ['startxfce4', 'xfce4-session'];
    const viewerBins = ['vncviewer', 'xtigervncviewer'];

    const [tv, nv, xf, vw] = await Promise.all([
      anyBin(this.host, tigervncBins),
      anyBin(this.host, novncBins),
      anyBin(this.host, xfceBins),
      anyBin(this.host, viewerBins),
    ]);

    // Also accept /usr/share/novnc presence as installed assets
    let novncAssets = false;
    try {
      const r = await this.host.runCommand(
        [
          'bash',
          '-c',
          'test -d /usr/share/novnc && echo ok; test -d /usr/share/novnc/utils && echo ok; true',
        ],
        { timeoutMs: 5_000 },
      );
      novncAssets = r.stdout.includes('ok');
    } catch {
      /* ignore */
    }

    const stacks: VncStackStatus[] = [
      {
        id: 'tigervnc',
        title: 'TigerVNC',
        installed: tv.installed,
        bins: tv.found,
        missingBins: tv.missing,
        notes: tv.installed
          ? []
          : [tl('notes.vnc.needInstall', { stack: 'TigerVNC' })],
      },
      {
        id: 'novnc',
        title: 'noVNC / websockify',
        installed: nv.installed || novncAssets,
        bins: nv.found,
        missingBins: nv.missing,
        notes:
          nv.installed || novncAssets
            ? novncAssets && !nv.installed
              ? [tl('notes.vnc.novncAssetsOnly')]
              : []
            : [tl('notes.vnc.needInstall', { stack: 'noVNC' })],
      },
      {
        id: 'xfce',
        title: 'XFCE desktop',
        installed: xf.installed,
        bins: xf.found,
        missingBins: xf.missing,
        notes: xf.installed ? [] : [tl('notes.vnc.needInstall', { stack: 'XFCE' })],
      },
      {
        id: 'viewer',
        title: 'VNC viewer',
        installed: vw.installed,
        bins: vw.found,
        missingBins: vw.missing,
        notes: vw.installed
          ? []
          : [tl('notes.vnc.needInstall', { stack: 'vncviewer' })],
      },
    ];
    return stacks;
  }

  async status(): Promise<VncOverviewStatus> {
    const stacks = await this.probeStacks();
    const settings = this.loadSettings();
    const accountCount = this.loadAccountCount();
    const notes: string[] = [];
    if (!this.host.executeEnabled()) {
      notes.push(tl('notes.vnc.needExecute'));
    }
    if (!this.host.isRoot()) {
      notes.push(tl('notes.vnc.needRoot'));
    }

    let endpointHint: string | null = null;
    try {
      const r = await this.host.runCommand(
        [
          'bash',
          '-c',
          "hostname -I 2>/dev/null | awk '{print $1}'; hostname -f 2>/dev/null | head -1",
        ],
        { timeoutMs: 5_000 },
      );
      const line = r.stdout
        .split(/\n/)
        .map((s) => s.trim())
        .find(Boolean);
      endpointHint = line || null;
    } catch {
      endpointHint = null;
    }

    return {
      stacks,
      accountCount,
      runningCount: 0,
      clientProfileCount: 0,
      clientConnectedCount: 0,
      settings,
      endpointHint,
      executeEnabled: this.host.executeEnabled(),
      isRoot: this.host.isRoot(),
      notes,
    };
  }
}

export function createVncService(dataDir: string, host: HostExecutor): VncService {
  return new VncService(dataDir, host);
}

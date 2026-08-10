/**
 * VNC service — multi-account server (PR-B) + settings/status.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, tl } from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';
import { ensureLinuxUser, removeLinuxUser } from './linux-user.js';
import { writeVncPassword } from './passwd.js';
import {
  linuxUserForSlug,
  parseGeometry,
  rfbPortForDisplay,
  sanitizeVncSlug,
} from './ports.js';
import {
  probeSessionRunning,
  startVncSession,
  stopVncSession,
  writeXstartupFile,
} from './server-session.js';
import {
  DEFAULT_VNC_SETTINGS,
  type VncAccountSummary,
  type VncDesktopProfile,
  type VncOverviewStatus,
  type VncRfbBind,
  type VncSettings,
  type VncStackStatus,
} from './types.js';

export type VncAccountRecord = {
  id: string;
  name: string;
  linuxUser: string;
  display: number;
  rfbPort: number;
  desktop: VncDesktopProfile;
  rfbBind: VncRfbBind;
  geometry: string;
  depth: number;
  autostart: boolean;
  hasPassword: boolean;
  osProvisioned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VncOpsResult = {
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  account?: VncAccountSummary;
  written?: string[];
};

async function binExists(host: HostExecutor, bin: string): Promise<boolean> {
  try {
    const r = await host.runCommand(
      ['bash', '-c', `command -v ${bin} >/dev/null 2>&1 && echo ok || true`],
      { timeoutMs: 5_000 },
    );
    return r.stdout.trim().includes('ok') || r.exitCode === 0;
  } catch {
    // Without YSK_EXECUTE, shell probes are blocked — best-effort path check
    return (
      existsSync(`/usr/bin/${bin}`) ||
      existsSync(`/bin/${bin}`) ||
      existsSync(`/usr/local/bin/${bin}`)
    );
  }
}

async function anyBin(
  host: HostExecutor,
  bins: string[],
): Promise<{ installed: boolean; missing: string[]; found: string[] }> {
  const found: string[] = [];
  const missing: string[] = [];
  for (const b of bins) {
    if (await binExists(host, b)) found.push(b);
    else missing.push(b);
  }
  return { installed: found.length > 0, missing, found };
}

function toSummary(
  rec: VncAccountRecord,
  status: VncAccountSummary['status'],
  novncRunning = false,
): VncAccountSummary {
  return {
    id: rec.id,
    name: rec.name,
    linuxUser: rec.linuxUser,
    display: rec.display,
    rfbPort: rec.rfbPort,
    desktop: rec.desktop,
    status,
    rfbBind: rec.rfbBind,
    geometry: rec.geometry,
    depth: rec.depth,
    autostart: rec.autostart,
    hasPassword: rec.hasPassword,
    novncRunning,
    createdAt: rec.createdAt,
  };
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

  private loadAccountsRaw(): VncAccountRecord[] {
    this.ensureDir();
    const p = this.accountsPath();
    if (!existsSync(p)) return [];
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as {
        items?: VncAccountRecord[];
      };
      return Array.isArray(raw.items) ? raw.items : [];
    } catch {
      return [];
    }
  }

  private saveAccounts(items: VncAccountRecord[]): void {
    this.ensureDir();
    writeFileSync(
      this.accountsPath(),
      JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2) +
        '\n',
      'utf8',
    );
  }

  private getAccountOrThrow(id: string): VncAccountRecord {
    const rec = this.loadAccountsRaw().find((a) => a.id === id);
    if (!rec) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.vnc.accountNotFound'), {
        httpStatus: 404,
      });
    }
    return rec;
  }

  private nextDisplay(settings: VncSettings, used: number[]): number {
    for (let d = settings.displayMin; d <= settings.displayMax; d++) {
      if (!used.includes(d)) return d;
    }
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.vnc.displayExhausted'), {
      httpStatus: 400,
    });
  }

  private async resolveStatus(
    rec: VncAccountRecord,
  ): Promise<VncAccountSummary['status']> {
    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      return rec.osProvisioned ? 'unknown' : 'written';
    }
    try {
      const up = await probeSessionRunning(this.host, rec.display);
      return up ? 'running' : 'stopped';
    } catch {
      return 'unknown';
    }
  }

  async listAccounts(): Promise<VncAccountSummary[]> {
    const items = this.loadAccountsRaw();
    const out: VncAccountSummary[] = [];
    for (const rec of items) {
      out.push(toSummary(rec, await this.resolveStatus(rec)));
    }
    return out;
  }

  async createAccount(input: {
    name: string;
    password?: string;
    desktop?: VncDesktopProfile;
    geometry?: string;
    depth?: number;
    rfbBind?: VncRfbBind;
    autostart?: boolean;
    display?: number;
    start?: boolean;
  }): Promise<VncOpsResult> {
    const notes: string[] = [];
    const settings = this.loadSettings();
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 64) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.vnc.invalidName'), {
        httpStatus: 400,
      });
    }
    const slug = sanitizeVncSlug(name);
    const linuxUser = linuxUserForSlug(slug);
    const items = this.loadAccountsRaw();
    if (items.some((a) => a.linuxUser === linuxUser || a.name.toLowerCase() === name.toLowerCase())) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.vnc.accountExists'), {
        httpStatus: 409,
      });
    }

    const used = items.map((a) => a.display);
    let display = input.display;
    if (display != null) {
      if (
        !Number.isInteger(display) ||
        display < settings.displayMin ||
        display > settings.displayMax ||
        used.includes(display)
      ) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.vnc.displayBusy'), {
          httpStatus: 400,
        });
      }
    } else {
      display = this.nextDisplay(settings, used);
    }

    const geometry = input.geometry ?? settings.defaultGeometry;
    if (!parseGeometry(geometry)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.vnc.invalidGeometry'), {
        httpStatus: 400,
      });
    }
    const depth = input.depth ?? settings.defaultDepth;
    const desktop = input.desktop ?? settings.defaultDesktop;
    const rfbBind = input.rfbBind ?? settings.defaultRfbBind;
    const autostart = input.autostart ?? settings.defaultAutostart;
    const now = new Date().toISOString();

    const rec: VncAccountRecord = {
      id: randomUUID(),
      name,
      linuxUser,
      display,
      rfbPort: rfbPortForDisplay(display),
      desktop,
      rfbBind,
      geometry,
      depth: depth === 16 ? 16 : 24,
      autostart: Boolean(autostart),
      hasPassword: false,
      osProvisioned: false,
      createdAt: now,
      updatedAt: now,
    };

    const userR = await ensureLinuxUser(this.host, linuxUser);
    notes.push(...userR.notes);
    rec.osProvisioned = userR.provisioned;
    const home = userR.home || `/home/${linuxUser}`;

    if (input.password) {
      const pw = await writeVncPassword({
        host: this.host,
        linuxUser,
        home,
        password: input.password,
      });
      notes.push(...pw.notes);
      if (pw.ok && !pw.blocked) rec.hasPassword = true;
      else if (pw.ok && pw.blocked && input.password.length >= 6) {
        // control-plane marks intent; real hash not on disk
        rec.hasPassword = true;
        notes.push(tl('notes.vnc.passwordMetaOnly'));
      } else if (!pw.ok) {
        // keep account but report
      }
    }

    const xs = await writeXstartupFile({
      host: this.host,
      linuxUser,
      home,
      desktop,
    });
    notes.push(...xs.notes);

    // Always persist control plane
    items.unshift(rec);
    this.saveAccounts(items);
    notes.push(
      tl('notes.vnc.accountCreated', {
        name,
        user: linuxUser,
        display: String(display),
      }),
    );

    let blocked = Boolean(userR.blocked);
    let requiresExecute = userR.requiresExecute;
    let requiresRoot = userR.requiresRoot;

    if (input.start) {
      const st = await startVncSession({
        host: this.host,
        linuxUser,
        display,
        geometry: rec.geometry,
        depth: rec.depth,
        rfbBind: rec.rfbBind,
      });
      notes.push(...st.notes);
      if (st.blocked) {
        blocked = true;
        requiresExecute = st.requiresExecute ?? requiresExecute;
        requiresRoot = st.requiresRoot ?? requiresRoot;
      }
    }

    const status = await this.resolveStatus(rec);
    return {
      ok: true,
      notes,
      blocked,
      requiresExecute,
      requiresRoot,
      account: toSummary(rec, status),
      written: [this.accountsPath()],
    };
  }

  async updateAccount(
    id: string,
    patch: {
      name?: string;
      desktop?: VncDesktopProfile;
      geometry?: string;
      depth?: number;
      rfbBind?: VncRfbBind;
      autostart?: boolean;
    },
  ): Promise<VncOpsResult> {
    const notes: string[] = [];
    const items = this.loadAccountsRaw();
    const idx = items.findIndex((a) => a.id === id);
    if (idx < 0) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.vnc.accountNotFound'), {
        httpStatus: 404,
      });
    }
    const rec = { ...items[idx] };
    if (patch.name != null) {
      const name = String(patch.name).trim();
      if (!name || name.length > 64) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.vnc.invalidName'), {
          httpStatus: 400,
        });
      }
      rec.name = name;
    }
    if (patch.geometry != null) {
      if (!parseGeometry(patch.geometry)) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.vnc.invalidGeometry'), {
          httpStatus: 400,
        });
      }
      rec.geometry = patch.geometry;
    }
    if (patch.depth != null) rec.depth = patch.depth === 16 ? 16 : 24;
    if (patch.rfbBind === 'localhost' || patch.rfbBind === 'all') {
      rec.rfbBind = patch.rfbBind;
    }
    if (typeof patch.autostart === 'boolean') rec.autostart = patch.autostart;
    if (
      patch.desktop === 'xfce' ||
      patch.desktop === 'minimal' ||
      patch.desktop === 'none'
    ) {
      rec.desktop = patch.desktop;
      const home = `/home/${rec.linuxUser}`;
      const xs = await writeXstartupFile({
        host: this.host,
        linuxUser: rec.linuxUser,
        home,
        desktop: rec.desktop,
      });
      notes.push(...xs.notes);
    }
    rec.updatedAt = new Date().toISOString();
    items[idx] = rec;
    this.saveAccounts(items);
    notes.push(tl('notes.vnc.accountUpdated', { name: rec.name }));
    return {
      ok: true,
      notes,
      account: toSummary(rec, await this.resolveStatus(rec)),
      written: [this.accountsPath()],
    };
  }

  async setPassword(id: string, password: string): Promise<VncOpsResult> {
    const rec = this.getAccountOrThrow(id);
    const items = this.loadAccountsRaw();
    const idx = items.findIndex((a) => a.id === id);
    const home = `/home/${rec.linuxUser}`;
    const pw = await writeVncPassword({
      host: this.host,
      linuxUser: rec.linuxUser,
      home,
      password,
    });
    if (!pw.ok) {
      return { ok: false, notes: pw.notes, blocked: pw.blocked, requiresExecute: pw.requiresExecute };
    }
    const next = { ...rec, hasPassword: true, updatedAt: new Date().toISOString() };
    items[idx] = next;
    this.saveAccounts(items);
    return {
      ok: true,
      notes: [...pw.notes, tl('notes.vnc.passwordUpdated', { name: rec.name })],
      blocked: pw.blocked,
      requiresExecute: pw.requiresExecute,
      account: toSummary(next, await this.resolveStatus(next)),
    };
  }

  async startAccount(id: string): Promise<VncOpsResult> {
    const rec = this.getAccountOrThrow(id);
    const notes: string[] = [];

    // Ensure user if not provisioned
    if (!rec.osProvisioned) {
      const userR = await ensureLinuxUser(this.host, rec.linuxUser);
      notes.push(...userR.notes);
      if (userR.provisioned) {
        const items = this.loadAccountsRaw();
        const idx = items.findIndex((a) => a.id === id);
        items[idx] = {
          ...rec,
          osProvisioned: true,
          updatedAt: new Date().toISOString(),
        };
        this.saveAccounts(items);
        rec.osProvisioned = true;
      }
    }

    const home = `/home/${rec.linuxUser}`;
    const xs = await writeXstartupFile({
      host: this.host,
      linuxUser: rec.linuxUser,
      home,
      desktop: rec.desktop,
    });
    notes.push(...xs.notes);

    const st = await startVncSession({
      host: this.host,
      linuxUser: rec.linuxUser,
      display: rec.display,
      geometry: rec.geometry,
      depth: rec.depth,
      rfbBind: rec.rfbBind,
    });
    notes.push(...st.notes);
    return {
      ok: st.ok || Boolean(st.blocked),
      notes,
      blocked: st.blocked,
      requiresExecute: st.requiresExecute,
      requiresRoot: st.requiresRoot,
      account: toSummary(rec, await this.resolveStatus(rec)),
    };
  }

  async stopAccount(id: string): Promise<VncOpsResult> {
    const rec = this.getAccountOrThrow(id);
    const st = await stopVncSession({
      host: this.host,
      linuxUser: rec.linuxUser,
      display: rec.display,
    });
    return {
      ok: st.ok || Boolean(st.blocked),
      notes: st.notes,
      blocked: st.blocked,
      requiresExecute: st.requiresExecute,
      account: toSummary(rec, await this.resolveStatus(rec)),
    };
  }

  async deleteAccount(
    id: string,
    opts?: { removeLinuxUser?: boolean },
  ): Promise<VncOpsResult> {
    const rec = this.getAccountOrThrow(id);
    const notes: string[] = [];
    // best-effort stop
    const stop = await stopVncSession({
      host: this.host,
      linuxUser: rec.linuxUser,
      display: rec.display,
    });
    notes.push(...stop.notes.filter((n) => !/blocked/i.test(n)));

    if (opts?.removeLinuxUser) {
      const del = await removeLinuxUser(this.host, rec.linuxUser, true);
      notes.push(...del.notes);
    } else {
      notes.push(tl('notes.vnc.linuxUserKept', { user: rec.linuxUser }));
    }

    const items = this.loadAccountsRaw().filter((a) => a.id !== id);
    this.saveAccounts(items);
    notes.push(tl('notes.vnc.accountDeleted', { name: rec.name }));
    return {
      ok: true,
      notes,
      blocked: stop.blocked,
      requiresExecute: stop.requiresExecute,
      written: [this.accountsPath()],
    };
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

    const novncAssets =
      existsSync('/usr/share/novnc') || existsSync('/usr/share/novnc/utils');

    return [
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
        notes: xf.installed
          ? []
          : [tl('notes.vnc.needInstall', { stack: 'XFCE' })],
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
  }

  async status(): Promise<VncOverviewStatus & { accounts: VncAccountSummary[] }> {
    const stacks = await this.probeStacks();
    const settings = this.loadSettings();
    const accounts = await this.listAccounts();
    const notes: string[] = [];
    if (!this.host.executeEnabled()) notes.push(tl('notes.vnc.needExecute'));
    if (!this.host.isRoot()) notes.push(tl('notes.vnc.needRoot'));

    let endpointHint: string | null = null;
    try {
      // Prefer simple read-only bins when EXECUTE is off
      const r = await this.host.runCommand(['hostname', '-I'], { timeoutMs: 5_000 });
      const line = r.stdout
        .split(/\s+/)
        .map((s) => s.trim())
        .find(Boolean);
      endpointHint = line || null;
    } catch {
      try {
        const r2 = await this.host.runCommand(['hostname'], { timeoutMs: 5_000 });
        endpointHint = r2.stdout.trim() || null;
      } catch {
        endpointHint = null;
      }
    }

    return {
      stacks,
      accountCount: accounts.length,
      runningCount: accounts.filter((a) => a.status === 'running').length,
      clientProfileCount: 0,
      clientConnectedCount: 0,
      settings,
      endpointHint,
      executeEnabled: this.host.executeEnabled(),
      isRoot: this.host.isRoot(),
      notes,
      accounts,
    };
  }
}

export function createVncService(dataDir: string, host: HostExecutor): VncService {
  return new VncService(dataDir, host);
}

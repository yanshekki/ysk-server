/**
 * VNC service — multi-account server (PR-B) + settings/status.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, tl } from '@yanshekki/shared';
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
  buildConnectionPayload,
  createViewTicket,
  isNovncRunning,
  openUfwTcpPort,
  startNovnc,
  stopNovnc,
} from './novnc.js';
import {
  clientDown,
  clientUp,
  createClientProfile,
  deleteClientProfile,
  getClientProfileRecord,
  listClientProfilesPublic,
  updateClientProfile,
} from './client-profiles.js';
import type { VncSessionKind } from './session-ticket.js';
import { probeResultNote, probeRfbTcp } from './rfb-probe.js';
import { resolveClientRfbHost } from './types.js';
import {
  DEFAULT_VNC_SETTINGS,
  normalizeVncDesktopProfile,
  type VncAccountSummary,
  type VncClientProfile,
  type VncConnectPath,
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

async function anyBin(
  host: HostExecutor,
  bins: string[],
): Promise<{ installed: boolean; missing: string[]; found: string[] }> {
  const { resolveBin } = await import('../software-probe/resolve-bin.js');
  const found: string[] = [];
  const missing: string[] = [];
  for (const b of bins) {
    const path = await resolveBin(host, b);
    if (path) found.push(path);
    else if (
      existsSync(`/usr/bin/${b}`) ||
      existsSync(`/bin/${b}`) ||
      existsSync(`/usr/local/bin/${b}`)
    ) {
      found.push(b);
    } else missing.push(b);
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
      const merged = { ...DEFAULT_VNC_SETTINGS, ...raw };
      merged.defaultDesktop = normalizeVncDesktopProfile(merged.defaultDesktop);
      return merged;
    } catch {
      return { ...DEFAULT_VNC_SETTINGS };
    }
  }

  saveSettings(patch: Partial<VncSettings>): VncSettings {
    this.ensureDir();
    const next = { ...this.loadSettings(), ...patch };
    next.defaultDesktop = normalizeVncDesktopProfile(next.defaultDesktop);
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
      const items = Array.isArray(raw.items) ? raw.items : [];
      return items.map((a) => ({
        ...a,
        desktop: normalizeVncDesktopProfile(a.desktop),
      }));
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
      out.push(
        toSummary(
          rec,
          await this.resolveStatus(rec),
          isNovncRunning(this.dataDir, rec.id),
        ),
      );
    }
    return out;
  }

  async getConnection(id: string): Promise<{
    ok: boolean;
    account: VncAccountSummary;
    connection: ReturnType<typeof buildConnectionPayload>;
    notes: string[];
  }> {
    const rec = this.getAccountOrThrow(id);
    const notes: string[] = [];
    let endpointHint: string | null = null;
    try {
      const r = await this.host.runCommand(['hostname', '-I'], { timeoutMs: 5_000 });
      endpointHint =
        r.stdout
          .split(/\s+/)
          .map((s) => s.trim())
          .find(Boolean) || null;
    } catch {
      endpointHint = null;
    }

    const novncOn = isNovncRunning(this.dataDir, id);
    let httpPort: number | null = null;
    let ticketToken: string | null = null;
    if (novncOn) {
      const { loadNovncRuntimes } = await import('./novnc.js');
      const rt = loadNovncRuntimes(this.dataDir).find((x) => x.accountId === id);
      httpPort = rt?.httpPort ?? null;
      if (httpPort != null) {
        const ticket = createViewTicket({
          dataDir: this.dataDir,
          accountId: id,
          httpPort,
        });
        ticketToken = ticket.token;
        notes.push(tl('notes.vnc.viewTicketIssued'));
      }
    }

    const account = toSummary(
      rec,
      await this.resolveStatus(rec),
      novncOn,
    );
    return {
      ok: true,
      account,
      connection: buildConnectionPayload({
        accountId: id,
        name: rec.name,
        linuxUser: rec.linuxUser,
        display: rec.display,
        rfbPort: rec.rfbPort,
        rfbBind: rec.rfbBind,
        endpointHint,
        novncHttpPort: httpPort,
        viewTicketToken: ticketToken,
      }),
      notes,
    };
  }

  async startNovncForAccount(id: string): Promise<VncOpsResult> {
    const rec = this.getAccountOrThrow(id);
    const r = await startNovnc({
      host: this.host,
      dataDir: this.dataDir,
      accountId: id,
      display: rec.display,
    });
    return {
      ok: r.ok || Boolean(r.blocked),
      notes: r.notes,
      blocked: r.blocked,
      requiresExecute: r.requiresExecute,
      account: toSummary(
        rec,
        await this.resolveStatus(rec),
        isNovncRunning(this.dataDir, id),
      ),
    };
  }

  async stopNovncForAccount(id: string): Promise<VncOpsResult> {
    const rec = this.getAccountOrThrow(id);
    const r = await stopNovnc({
      host: this.host,
      dataDir: this.dataDir,
      accountId: id,
    });
    return {
      ok: r.ok || Boolean(r.blocked),
      notes: r.notes,
      blocked: r.blocked,
      requiresExecute: r.requiresExecute,
      account: toSummary(
        rec,
        await this.resolveStatus(rec),
        isNovncRunning(this.dataDir, id),
      ),
    };
  }

  async openFirewallForAccount(id: string): Promise<VncOpsResult> {
    const rec = this.getAccountOrThrow(id);
    const r = await openUfwTcpPort({
      host: this.host,
      port: rec.rfbPort,
      comment: `ysk-svc:vnc-${id.slice(0, 12)}:rfb`,
    });
    return {
      ok: r.ok || Boolean(r.blocked),
      notes: r.notes,
      blocked: r.blocked,
      requiresExecute: r.requiresExecute,
      account: toSummary(
        rec,
        await this.resolveStatus(rec),
        isNovncRunning(this.dataDir, id),
      ),
    };
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
    const desktop = normalizeVncDesktopProfile(input.desktop ?? settings.defaultDesktop);
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

    // Under EXECUTE on every host, xstartup must be on disk or session start is doomed
    if (!xs.ok && this.host.executeEnabled() && this.host.isRoot()) {
      return {
        ok: false,
        notes,
        account: toSummary(rec, await this.resolveStatus(rec)),
        written: [this.accountsPath()],
      };
    }

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
        home,
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
    if (patch.desktop != null) {
      rec.desktop = normalizeVncDesktopProfile(patch.desktop);
      const home = `/home/${rec.linuxUser}`;
      const xs = await writeXstartupFile({
        host: this.host,
        linuxUser: rec.linuxUser,
        home,
        desktop: rec.desktop,
      });
      notes.push(...xs.notes);
      // Desktop only takes effect on a new X session — bounce if currently up
      if (xs.ok && this.host.executeEnabled() && this.host.isRoot()) {
        const wasUp = await probeSessionRunning(this.host, rec.display);
        if (wasUp) {
          await stopVncSession({
            host: this.host,
            linuxUser: rec.linuxUser,
            display: rec.display,
          });
          const st = await startVncSession({
            host: this.host,
            linuxUser: rec.linuxUser,
            display: rec.display,
            geometry: rec.geometry,
            depth: rec.depth,
            rfbBind: rec.rfbBind,
            home,
          });
          notes.push(...st.notes);
          if (st.ok) {
            notes.push(tl('notes.vnc.desktopRestarted', { desktop: rec.desktop }));
          }
        } else {
          notes.push(tl('notes.vnc.desktopNeedsStart', { desktop: rec.desktop }));
        }
      }
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
    const prepNotes: string[] = [];

    // Ensure user if not provisioned
    if (!rec.osProvisioned) {
      const userR = await ensureLinuxUser(this.host, rec.linuxUser);
      prepNotes.push(...userR.notes);
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
      } else if (userR.blocked) {
        return {
          ok: false,
          notes: prepNotes,
          blocked: true,
          requiresExecute: userR.requiresExecute,
          requiresRoot: userR.requiresRoot,
          account: toSummary(rec, await this.resolveStatus(rec)),
        };
      }
    }

    // Control-plane: no password ever set → fail before shell noise
    if (!rec.hasPassword) {
      return {
        ok: false,
        notes: [tl('notes.vnc.needPasswordBeforeStart'), ...prepNotes],
        account: toSummary(rec, await this.resolveStatus(rec)),
      };
    }

    const home = `/home/${rec.linuxUser}`;
    const xs = await writeXstartupFile({
      host: this.host,
      linuxUser: rec.linuxUser,
      home,
      desktop: rec.desktop,
    });
    if (!xs.ok) {
      return {
        ok: false,
        notes: [...xs.notes, ...prepNotes],
        account: toSummary(rec, await this.resolveStatus(rec)),
      };
    }

    const st = await startVncSession({
      host: this.host,
      linuxUser: rec.linuxUser,
      display: rec.display,
      geometry: rec.geometry,
      depth: rec.depth,
      rfbBind: rec.rfbBind,
      home,
      requirePassword: true,
    });

    // Failure: lead with start error (not "wrote xstartup") so OpsResult shows it primary
    if (!st.ok && !st.blocked) {
      return {
        ok: false,
        notes: [...st.notes, ...prepNotes],
        blocked: st.blocked,
        requiresExecute: st.requiresExecute,
        requiresRoot: st.requiresRoot,
        account: toSummary(rec, await this.resolveStatus(rec)),
      };
    }

    const notes = [...st.notes, ...xs.notes, ...prepNotes];
    // Public RFB bind → auto open host firewall (ysk-svc:vnc-<id>:rfb)
    if (st.ok && rec.rfbBind === 'all') {
      const sid = `vnc-${id.slice(0, 12)}`;
      const fw = await openUfwTcpPort({
        host: this.host,
        port: rec.rfbPort,
        comment: `ysk-svc:${sid}:rfb`,
      });
      notes.push(...fw.notes);
    }

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
    const notes = [...st.notes];
    // Drop managed VNC firewall rules for this account
    try {
      const { firewallDeleteByComment } = await import('../firewall-ops.js');
      const del = await firewallDeleteByComment(
        this.host,
        `ysk-svc:vnc-${id.slice(0, 12)}:`,
      );
      if (del.removed > 0) notes.push(...del.notes.slice(0, 2));
    } catch {
      /* non-fatal */
    }
    return {
      ok: st.ok || Boolean(st.blocked),
      notes,
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
    // Prefer tigervncserver (Debian/Ubuntu package name); include X server bins for presence
    const tigervncBins = [
      'tigervncserver',
      'vncserver',
      'Xtigervnc',
      'Xvnc',
      'x0vncserver',
    ];
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

  listClientProfiles(): VncClientProfile[] {
    return listClientProfilesPublic(this.dataDir);
  }

  /**
   * Resolve RFB target for an in-browser VNC session (panel WS will TCP-proxy).
   * Account: ensure desktop is running on localhost RFB.
   * Client: connect outbound from this host to profile host:port.
   */
  async prepareBrowserSession(input: {
    kind: VncSessionKind;
    id: string;
  }): Promise<{
    ok: boolean;
    notes: string[];
    blocked?: boolean;
    requiresExecute?: boolean;
    label?: string;
    rfbHost?: string;
    rfbPort?: number;
    /** Optional stored RFB password (client profiles only; never for accounts) */
    passwordHint?: string;
  }> {
    const notes: string[] = [];
    if (input.kind === 'account') {
      const rec = this.getAccountOrThrow(input.id);
      const status = await this.resolveStatus(rec);
      if (status !== 'running') {
        if (!this.host.executeEnabled() || !this.host.isRoot()) {
          notes.push(tl('notes.vnc.viewerNeedExecute'));
          return {
            ok: false,
            notes,
            blocked: true,
            requiresExecute: !this.host.executeEnabled(),
          };
        }
        const start = await this.startAccount(rec.id);
        notes.push(...start.notes);
        if (!start.ok && !start.blocked) {
          return { ok: false, notes };
        }
        if (start.blocked) {
          return {
            ok: false,
            notes,
            blocked: true,
            requiresExecute: start.requiresExecute,
          };
        }
      }
      notes.push(tl('notes.vnc.browserSessionReady', { name: rec.name }));
      return {
        ok: true,
        notes,
        label: rec.name,
        rfbHost: '127.0.0.1',
        rfbPort: rec.rfbPort,
      };
    }

    // client outbound
    const cl = getClientProfileRecord(this.dataDir, input.id);
    if (!cl) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.vnc.clientNotFound'), {
        httpStatus: 404,
      });
    }
    const pathMode =
      cl.path === 'server_proxy' ? 'server_proxy' : 'user_reachable';
    const rfbHost = resolveClientRfbHost(cl);
    const displayTarget = `${cl.host}:${cl.port}`;
    const connectTarget = `${rfbHost}:${cl.port}`;

    // Preflight: can this control plane open TCP to the RFB target?
    const probe = await probeRfbTcp(rfbHost, cl.port);
    if (!probe.ok) {
      notes.push(probeResultNote(probe));
      notes.push(
        pathMode === 'server_proxy'
          ? tl('notes.vnc.probeHintServerProxy')
          : tl('notes.vnc.probeHintUserReachable'),
      );
      if (pathMode === 'server_proxy' && rfbHost !== cl.host) {
        notes.push(
          tl('notes.vnc.probeConnectHostHint', {
            display: displayTarget,
            connect: connectTarget,
          }),
        );
      }
      return { ok: false, notes };
    }

    notes.push(
      tl('notes.vnc.browserSessionReady', {
        name: `${cl.name} (${displayTarget})`,
      }),
    );
    notes.push(
      pathMode === 'server_proxy'
        ? tl('notes.vnc.clientPathServerProxy', {
            name: cl.name,
            target: connectTarget,
          })
        : tl('notes.vnc.clientPathUserReachable', {
            name: cl.name,
            target: displayTarget,
          }),
    );
    if (pathMode === 'server_proxy' && rfbHost !== cl.host) {
      notes.push(
        tl('notes.vnc.connectHostOverride', {
          display: cl.host,
          connect: rfbHost,
        }),
      );
    }
    notes.push(tl('notes.vnc.probeOk', { target: connectTarget }));
    return {
      ok: true,
      notes,
      label: cl.name,
      rfbHost,
      rfbPort: cl.port,
      passwordHint: cl.password || undefined,
    };
  }

  createClientProfile(input: {
    name: string;
    host: string;
    port: number;
    path?: VncConnectPath;
    connectHost?: string;
    password?: string;
    autostart?: boolean;
  }): VncClientProfile {
    return createClientProfile(this.dataDir, input);
  }

  updateClientProfile(
    id: string,
    patch: {
      name?: string;
      host?: string;
      port?: number;
      path?: VncConnectPath;
      connectHost?: string | null;
      autostart?: boolean;
      password?: string | null;
    },
  ): VncClientProfile {
    return updateClientProfile(this.dataDir, id, patch);
  }

  async clientUp(
    id: string,
    path?: VncConnectPath,
  ): Promise<VncOpsResult & { profile?: VncClientProfile }> {
    const r = await clientUp({
      host: this.host,
      dataDir: this.dataDir,
      id,
      path,
    });
    return {
      ok: r.ok || Boolean(r.blocked),
      notes: r.notes,
      blocked: r.blocked,
      requiresExecute: r.requiresExecute,
      profile: r.profile,
    };
  }

  async clientDown(
    id: string,
  ): Promise<VncOpsResult & { profile?: VncClientProfile }> {
    const r = await clientDown({
      host: this.host,
      dataDir: this.dataDir,
      id,
    });
    return {
      ok: r.ok || Boolean(r.blocked),
      notes: r.notes,
      blocked: r.blocked,
      requiresExecute: r.requiresExecute,
      profile: r.profile,
    };
  }

  async deleteClientProfile(id: string): Promise<VncOpsResult> {
    const r = await deleteClientProfile({
      host: this.host,
      dataDir: this.dataDir,
      id,
    });
    return { ok: r.ok, notes: r.notes };
  }

  async status(): Promise<
    VncOverviewStatus & {
      accounts: VncAccountSummary[];
      clientProfiles: VncClientProfile[];
    }
  > {
    const stacks = await this.probeStacks();
    const settings = this.loadSettings();
    const accounts = await this.listAccounts();
    const clientProfiles = this.listClientProfiles();
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
      clientProfileCount: clientProfiles.length,
      clientConnectedCount: clientProfiles.filter((c) => c.status === 'up').length,
      settings,
      endpointHint,
      executeEnabled: this.host.executeEnabled(),
      isRoot: this.host.isRoot(),
      notes,
      accounts,
      clientProfiles,
    };
  }
}

export function createVncService(dataDir: string, host: HostExecutor): VncService {
  return new VncService(dataDir, host);
}

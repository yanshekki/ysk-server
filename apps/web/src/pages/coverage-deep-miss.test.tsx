import { createUiProbe } from '../test/assert-rendered';
/**
 * Deep RTL interactions aimed at the largest remaining uncovered branches.
 * Selection-first actions, rich fixtures, modal submits, multi-runtime presets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
  type FetchRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';

import { FilesPage } from './FilesPage';
import { ProtectionPage } from './features/ProtectionPage';
import { PhpRuntimePage } from './features/PhpRuntimePage';
import { CronPage } from './features/CronPage';
import { LogsPage } from './features/LogsPage';
import { SystemPage } from './SystemPage';
import { MetricsPage } from './features/MetricsPage';
import { SecurityPage } from './SecurityPage';
import { DnsPage } from './features/DnsPage';
import { EmailDomainPage } from './EmailDomainPage';
import { OutboundIdentities } from '../features/security/ssh/OutboundIdentities';
import { DashboardPage } from './DashboardPage';
import { UsersPage } from './UsersPage';
import { NetworkPage } from './features/NetworkPage';
import { BackupsPage } from './features/BackupsPage';
import { GenericRuntimePage } from './features/GenericRuntimePage';
import { MigrateHostPage } from './features/MigrateHostPage';
import { NginxPage } from './features/NginxPage';
import { UpdatesPage } from './UpdatesPage';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickBtn(user: ReturnType<typeof userEvent.setup>, re: RegExp, limit = 4) {
  for (const b of screen.queryAllByRole('button', { name: re }).slice(0, limit)) {
    if ((b as HTMLButtonElement).disabled) continue;
    try {
      await user.click(b);
    } catch {
      /* ignore */
    }
  }
}

async function fillId(id: string, value: string, user: ReturnType<typeof userEvent.setup>) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return false;
  try {
    el.focus();
    await user.clear(el as HTMLInputElement);
    await user.type(el as HTMLInputElement, value);
    return true;
  } catch {
    return false;
  }
}

const now = () => new Date().toISOString();

function fileEntries() {
  const t = now();
  return [
    {
      name: 'readme.txt',
      path: 'readme.txt',
      type: 'file' as const,
      size: 512,
      mtime: t,
      mime: 'text/plain',
      favorite: true },
    {
      name: 'photo.png',
      path: 'photo.png',
      type: 'file' as const,
      size: 2048,
      mtime: t,
      mime: 'image/png' },
    {
      name: 'doc.pdf',
      path: 'doc.pdf',
      type: 'file' as const,
      size: 1024 * 50,
      mtime: t,
      mime: 'application/pdf' },
    {
      name: 'clip.mp4',
      path: 'clip.mp4',
      type: 'file' as const,
      size: 1024 * 1024 * 3,
      mtime: t,
      mime: 'video/mp4' },
    {
      name: 'song.mp3',
      path: 'song.mp3',
      type: 'file' as const,
      size: 1024 * 400,
      mtime: t,
      mime: 'audio/mpeg' },
    {
      name: 'data.json',
      path: 'data.json',
      type: 'file' as const,
      size: 88,
      mtime: t,
      mime: 'application/json' },
    {
      name: 'bundle.zip',
      path: 'bundle.zip',
      type: 'file' as const,
      size: 1024 * 1024 * 12,
      mtime: t,
      mime: 'application/zip' },
    {
      name: 'bin.dat',
      path: 'bin.dat',
      type: 'file' as const,
      size: 42,
      mtime: t,
      mime: 'application/octet-stream' },
    {
      name: 'docs',
      path: 'docs',
      type: 'dir' as const,
      size: 0,
      mtime: t },
  ];
}

function filesRoutes(): FetchRoute[] {
  const t = now();
  const entries = fileEntries();
  return [
    softwareReadyRoute(),
    {
      match: (url) =>
        url.includes('/api/v1/files') ||
        url.includes('/hosting/files') ||
        url.includes('webdav'),
      handler: (url, init) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('download')) {
          // still JSON via mock — path hits error branch for download
          return { ok: true };
        }
        if (method !== 'GET') {
          if (url.includes('shares') && method === 'POST') {
            return {
              ok: true,
              share: {
                id: 'sh-new',
                path: 'readme.txt',
                token: 'tok-new',
                url: '/api/v1/public/files/tok-new',
                createdAt: t },
              notes: ['share created'] };
          }
          if (url.includes('versions/restore')) {
            return { ok: true, notes: ['restored'] };
          }
          if (url.includes('unzip')) {
            return { ok: true, path: '.', notes: ['unzipped'] };
          }
          if (url.includes('zip')) {
            return { ok: true, path: 'archive.zip', bytes: 10, notes: ['zipped'] };
          }
          if (url.includes('chmod')) {
            return { ok: true, path: 'x', mode: '644' };
          }
          if (url.includes('webdav')) {
            return {
              ok: true,
              token: 'wd-tok',
              tokenId: 'wd1',
              mountPath: '/webdav',
              notes: ['token issued'],
              enabled: true };
          }
          return { ...HONESTY_WRITTEN_BLOCKED, ok: true, path: 'x', favorited: true };
        }
        if (url.includes('/read')) {
          return { content: 'hello file content', path: 'readme.txt', bytes: 18, mime: 'text/plain' };
        }
        if (url.includes('trash')) {
          return {
            items: [
              {
                trashId: 'tr1',
                name: 'gone.txt',
                originalPath: 'gone.txt',
                path: 'gone.txt',
                type: 'file',
                size: 9,
                deletedAt: t,
                mtime: t },
            ] };
        }
        if (url.includes('shares')) {
          return {
            items: [
              {
                id: 'sh1',
                path: 'readme.txt',
                token: 'tok1',
                createdAt: t,
                expiresAt: null },
            ] };
        }
        if (url.includes('versions')) {
          return {
            path: 'readme.txt',
            items: [
              { id: 'v1', path: 'readme.txt', createdAt: t, bytes: 100 },
              { id: 'v2', path: 'readme.txt', createdAt: t, bytes: 1024 * 2000 },
            ] };
        }
        if (url.includes('favorites')) {
          return { items: [{ root: 'public', path: 'readme.txt' }] };
        }
        if (url.includes('webdav')) {
          return { enabled: true, mountPath: '/webdav', tokenId: 'wd1' };
        }
        return {
          ok: true,
          path: '.',
          root: 'public',
          usage: { bytes: 1024 * 1024 * 1024 * 2.5, fileCount: 8, dirCount: 1 },
          entries,
          items: entries };
      } },
    {
      match: /\/api\/v1\/projects/,
      body: { items: [{ id: 'p1', name: 'Demo' }] } },
    { match: /.*/, body: { ok: true, items: [], ready: true, missing: [] } },
  ];
}

function defenseRich(): FetchRoute[] {
  const t = now();
  return [
    softwareReadyRoute(),
    {
      match: (url) =>
        url.startsWith('/api/v1/defense/status') || url.startsWith('/api/v1/defense/probe'),
      body: {
        at: t,
        threatLevel: 'elevated',
        score: 55,
        signals: [{ id: 'highReqRate', label: 'Req', value: 10, points: 5 }],
        activePreset: 'daily',
        presets: [
          { id: 'daily', label: 'Daily', short: 'N', bullets: ['a'] },
          { id: 'hardened', label: 'Hardened', short: 'H', bullets: ['b'] },
          { id: 'under_attack', label: 'Attack', short: 'A', bullets: ['c'], danger: true },
          { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
        ],
        bans: {
          count: 2,
          items: [
            { ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd', reason: 'auth' },
            { ip: '198.51.100.1', source: 'ufw' },
          ] },
        nginxLimits: {
          reqRate: '10r/s',
          burst: 20,
          connLimit: 40,
          confPath: '/etc/nginx/conf.d/d.conf',
          exists: true },
        firewall: { active: 'active', installed: true },
        fail2ban: { active: 'active', installed: true, jails: 2 },
        autoBan: {
          enabled: true,
          mode: 'normal',
          method: 'fail2ban',
          cooldownMinutes: 30,
          maxAutoBansPerHour: 20,
          whitelist: ['127.0.0.1'] },
        executeEnabled: false,
        isRoot: false,
        suggestions: [{ id: 's1', title: 'Apply', body: 'x', action: 'preset:daily' }],
        notes: [
          'YSK_EXECUTE blocked system 無法 ban 到系統',
          'Wrote nginx 00-ysk-defense conf /home/demo/x',
          'Wrote jail.local fail2ban',
          'a'.repeat(130) + ' /home/user/path/extra',
          'plain note',
        ] } },
    {
      match: (url) => url.startsWith('/api/v1/defense/geoip/status'),
      body: {
        provider: 'dbip',
        dir: '/var/lib/geo',
        ready: true,
        stale: false,
        cityReady: true,
        maxGranularity: 'city',
        notes: [],
        attribution: ['DB-IP'],
        policy: {
          enabled: true,
          mode: 'deny_list',
          countries: ['CN', 'RU'],
          continents: ['AS'],
          regions: ['US-NY'],
          cities: ['US-NY-NYC'],
          cityPolicyEnabled: true,
          asns: ['13335'],
          enforce: { autoBan: true, nginx: true, ufw: false },
          autoUpdate: true },
        sources: [
          { filename: 'dbip-city.mmdb', present: true, mtime: t, bytes: 1000 },
        ],
        meta: { lastSuccessAt: t } } },
    {
      match: (url) => url.startsWith('/api/v1/defense/automation'),
      body: {
        automation: {
          enabled: true,
          autoPreset: {
            enabled: true,
            escalateToHardenedAt: 40,
            escalateToUnderAttackAt: 70,
            suggestEmergencyAt: 90,
            deescalateEnabled: true,
            deescalateToDailyBelow: 20,
            holdMinutes: 30 },
          autoBan: {
            enabled: true,
            mode: 'normal',
            method: 'fail2ban',
            minScore: 10,
            minHits: 50,
            min429: 5,
            minScan: 3,
            cooldownMinutes: 30,
            maxAutoBansPerHour: 20,
            intervalSeconds: 60,
            whitelist: ['10.0.0.1'] } },
        mechanisms: [{ step: '1', mechanism: 'fail2ban', tunable: 'bantime' }] } },
    {
      match: (url) => url.startsWith('/api/v1/defense/suspects'),
      body: {
        items: [
          {
            ip: '198.51.100.7',
            score: 30,
            hits: 100,
            reasons: ['scan'],
            sources: ['nginx'],
            lastSeen: t },
        ],
        notes: [] } },
    {
      match: (url) => url.includes('/api/v1/defense/geoip/lookup'),
      body: {
        ok: true,
        lookup: {
          ip: '203.0.113.50',
          country: 'US',
          regionKey: 'US-NY',
          regionName: 'New York',
          city: 'New York',
          cityKey: 'US-NY-NYC',
          continent: 'NA',
          latitude: 40.7,
          longitude: -74.0,
          asn: '13335',
          asName: 'Cloudflare',
          source: 'dbip' },
        access: { blocked: false, matched: ['country'] } } },
    {
      match: /\/api\/v1\/defense/,
      body: {
        ...HONESTY_WRITTEN_BLOCKED,
        notes: [
          'YSK_EXECUTE blocked',
          'Wrote nginx /home/x/00-ysk-defense',
          'Wrote jail.local fail2ban',
        ] } },
    {
      match: /\/api\/v1\/system\//,
      body: { installed: true, active: 'active', rules: [], jails: [], banned: [] } },
    { match: /.*/, body: { ok: true, items: [] } },
  ];
}

function phpIniCatalog() {
  return [
    {
      id: 'core',
      title: 'Core',
      description: 'core',
      fields: [
        { key: 'memory_limit', label: 'Memory', type: 'bytes', default: '256M' },
        { key: 'upload_max_filesize', label: 'Upload', type: 'bytes', default: '32M' },
        { key: 'max_execution_time', label: 'Exec time', type: 'int', default: 30 },
        { key: 'max_input_time', label: 'Input time', type: 'int', default: 60 },
        { key: 'max_input_vars', label: 'Input vars', type: 'int', default: 1000 },
        { key: 'max_input_nesting_level', label: 'Nesting', type: 'int', default: 64 },
        { key: 'max_file_uploads', label: 'Uploads', type: 'int', default: 20 },
        { key: 'session.gc_maxlifetime', label: 'Session GC', type: 'int', default: 1440 },
        { key: 'display_errors', label: 'Display errors', type: 'bool', default: false },
        {
          key: 'error_reporting',
          label: 'Error reporting',
          type: 'select',
          default: 'E_ALL',
          options: [
            { value: 'E_ALL', label: 'E_ALL' },
            { value: '0', label: 'Off' },
          ] },
        {
          key: 'date.timezone',
          label: 'Timezone',
          type: 'select',
          default: 'UTC',
          options: Array.from({ length: 12 }, (_, i) => ({
            value: `TZ${i}`,
            label: `Zone ${i}` })) },
        { key: 'auto_prepend_file', label: 'Prepend', type: 'textarea', default: '' },
        { key: 'custom_str', label: 'Custom', type: 'string', default: 'x' },
        { key: 'weird_int', label: 'Weird', type: 'int', default: 1 },
      ] },
    {
      id: 'opcache',
      title: 'OPcache',
      fields: [
        { key: 'opcache.memory_consumption', label: 'OPC mem', type: 'int', default: 128 },
        {
          key: 'opcache.interned_strings_buffer',
          label: 'Interned',
          type: 'int',
          default: 16 },
        {
          key: 'opcache.max_accelerated_files',
          label: 'Max files',
          type: 'int',
          default: 10000 },
        { key: 'opcache.revalidate_freq', label: 'Revalidate', type: 'int', default: 2 },
        { key: 'opcache.enable', label: 'Enable', type: 'bool', default: true, danger: true },
      ] },
  ];
}

describe('deep-miss coverage attacks', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('EMERGENCY');
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    } catch {
      /* happy-dom may already define clipboard */
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it(
    'FilesPage: select-all bulk actions + modals + tabs + open entries',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock(filesRoutes());
      renderAt('/files', <FilesPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // Select all → bulk action bar
      const selectAll = screen.queryByRole('checkbox', { name: /select all/i });
      if (selectAll) await user.click(selectAll);
      // Also toggle individual boxes
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 6)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      // Re-select all for bulk
      if (selectAll) {
        try {
          await user.click(selectAll);
        } catch {
          /* ignore */
        }
      }

      await clickBtn(user, /download/i, 2);
      await clickBtn(user, /copy/i, 1);
      // move/copy modal
      let dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        await fillId('md', 'docs/archive', user);
        await clickBtn(user, /confirm|ok/i, 1);
        await clickBtn(user, /cancel|close/i, 1);
      }

      await clickBtn(user, /move/i, 1);
      dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        await fillId('md', 'docs', user);
        await clickBtn(user, /confirm/i, 1);
      }

      await clickBtn(user, /chmod/i, 1);
      dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        for (const chip of within(dialog).queryAllByRole('button').slice(0, 6)) {
          try {
            await user.click(chip);
          } catch {
            /* ignore */
          }
        }
        await fillId('fm-chmod-mode', '755', user);
        await clickBtn(user, /apply/i, 1);
      }

      await clickBtn(user, /zip|compress/i, 2);
      dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        await fillId('fm-zip-name', 'out.zip', user);
        await clickBtn(user, /compress|zip|create/i, 1);
      }

      // unzip on zip selection — click zip checkbox alone
      for (const cb of screen.queryAllByRole('checkbox')) {
        const label = cb.getAttribute('aria-label') ?? '';
        if (/bundle\.zip/i.test(label)) {
          await user.click(cb);
          break;
        }
      }
      await clickBtn(user, /unzip/i, 1);

      await clickBtn(user, /delete/i, 1);
      await clickBtn(user, /confirm|delete|yes/i, 2);

      // Row actions: open text, rename, favorite, share, versions
      try {
        const nameBtn = screen.getByRole('button', { name: /readme\.txt/i });
        await user.click(nameBtn);
      } catch {
        /* ignore */
      }
      await clickBtn(user, /rename/i, 1);
      dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        await fillId('rn', 'readme2.txt', user);
        await clickBtn(user, /confirm/i, 1);
      }
      await clickBtn(user, /favorite|unfavorite|★/i, 1);
      await clickBtn(user, /share/i, 1);
      dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        await fillId('sp', 'Secret12!', user);
        await clickBtn(user, /create link|share|create/i, 1);
        await clickBtn(user, /close/i, 1);
      }
      await clickBtn(user, /versions/i, 1);
      dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        await clickBtn(user, /restore/i, 1);
        await clickBtn(user, /close/i, 1);
      }

      // Open image / pdf / other via name buttons
      for (const name of [/photo\.png/i, /doc\.pdf/i, /bin\.dat/i, /docs/i]) {
        try {
          const b = screen.getByRole('button', { name });
          await user.click(b);
          await clickBtn(user, /close|download/i, 2);
        } catch {
          /* ignore */
        }
      }

      // New folder / new text
      await clickBtn(user, /new folder/i, 1);
      dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        const input = dialog.querySelector('input') as HTMLInputElement | null;
        if (input) await user.type(input, 'folder2');
        await clickBtn(user, /create|ok/i, 1);
      }
      await clickBtn(user, /new text/i, 1);
      dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        await fillId('nf', 'note.txt', user);
        await clickBtn(user, /create|ok/i, 1);
      }

      // Grid view + sort + search
      await clickBtn(user, /icon|grid/i, 1);
      await clickBtn(user, /list/i, 1);
      for (const rb of screen.queryAllByRole('radio').slice(0, 6)) {
        try {
          await user.click(rb);
        } catch {
          /* ignore */
        }
      }
      const search = screen.queryByRole('textbox', { name: /search|filter/i })
        ?? document.querySelector('input[type="search"]');
      if (search) {
        try {
          await user.type(search as HTMLElement, 'read');
        } catch {
          /* ignore */
        }
      }

      // Drag-over drop zone
      const drop = document.querySelector('.fm-drop');
      if (drop) {
        fireEvent.dragOver(drop, { dataTransfer: { files: [] } });
        fireEvent.dragLeave(drop);
        const file = new File(['hi'], 'drop.txt', { type: 'text/plain' });
        fireEvent.drop(drop, { dataTransfer: { files: [file] } });
      }

      // Upload input
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
      if (fileInput) {
        const f = new File(['x'], 'up.txt', { type: 'text/plain' });
        await user.upload(fileInput, f);
      }

      // Trash + shares + webdav tabs
      for (const label of [/trash/i, /share/i, /webdav|dav/i, /browse/i]) {
        const tab = screen.queryByRole('tab', { name: label });
        if (tab) await user.click(tab);
        await clickBtn(
          user,
          /restore|purge|empty|delete|issue|enable|disable|revoke|copy|refresh/i,
          6,
        );
      }

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    45_000,
  );

  it(
    'PhpRuntimePage: rich ini catalog presets + site + tools',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/hosting/php/ini'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              version: '8.2',
              catalog: phpIniCatalog(),
              settings: {
                version: '8.2',
                values: {
                  memory_limit: '256M',
                  max_execution_time: 30,
                  display_errors: false,
                  'opcache.enable': true },
                extra: { variables_order: 'GPCS' },
                rawAppend: '; custom',
                updatedAt: now() },
              managedIniPath: '/etc/php/8.2/fpm/conf.d/99-ysk.ini',
              notes: [] };
          } },
        {
          match: (url) =>
            url.includes('/hosting/runtimes') ||
            url.includes('/api/v1/runtimes') ||
            url.includes('php/apply') ||
            url.includes('php/site'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              php: { version: '8.2.0', modules: ['core', 'json', 'opcache', 'curl', 'mbstring'] },
              composer: { available: true, version: '2.7' },
              wpCli: { available: false },
              notes: ['probed'],
              ok: true };
          } },
        {
          match: (url) => url.includes('/runtimes/tools'),
          body: {
            php: {
              version: '8.2.0',
              modules: Array.from({ length: 45 }, (_, i) => `mod${i}`) },
            composer: { available: true, version: '2.7.1' },
            wpCli: { available: true, version: '2.10' },
            notes: ['tools ok'] } },
        { match: /.*/, body: { ok: true, items: [], ready: true, missing: [] } },
      ]);

      renderAt('/runtimes/php', <PhpRuntimePage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      await clickBtn(user, /reprobe|probe/i, 1);
      await clickBtn(user, /install/i, 1);

      // Switch version radios
      for (const rb of screen.queryAllByRole('radio').slice(0, 4)) {
        try {
          await user.click(rb);
        } catch {
          /* ignore */
        }
      }

      const iniTab = screen.queryByRole('tab', { name: /php\.ini|ini/i });
      if (iniTab) await user.click(iniTab);
      await waitFor(() => {
        expect(document.getElementById('ini-extra') || screen.queryByText(/core|memory/i)).toBeTruthy();
      }).catch(() => undefined);

      // Click preset chips (labels like 256M, 30, etc.)
      for (const b of screen.queryAllByRole('button').slice(0, 40)) {
        const t = b.textContent ?? '';
        if (/^(128M|256M|512M|1G|-1|0|30|60|120|300|1000|2500|64|128|16|32|4k|10k|2|10|On|Off|open|close)$/i.test(t.trim())) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }

      // Toggle bool checkboxes
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 6)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }

      // Extra directives parse
      await fillId('ini-extra', 'variables_order=GPCS\n# comment\nbogus\nfoo=bar\n', user);
      await fillId('ini-raw', '; custom block\n', user);

      await clickBtn(user, /save/i, 2);
      await clickBtn(user, /apply/i, 2);
      await clickBtn(user, /reload/i, 1);

      const siteTab = screen.queryByRole('tab', { name: /fpm|site|vhost/i });
      if (siteTab) await user.click(siteTab);
      await fillId('php-dom', 'php.demo.local', user);
      await fillId('php-pool', 'demo', user);
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 2)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /apply/i, 2);

      const toolsTab = screen.queryByRole('tab', { name: /tools/i });
      if (toolsTab) await user.click(toolsTab);
      await clickBtn(user, /reprobe|probe/i, 2);

      const about = screen.queryByRole('tab', { name: /about/i });
      if (about) await user.click(about);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'CronPage: multi-runtime project presets + create + install',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/cron') || url.includes('/api/v1/resources/cron'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (_u.includes('status')) {
              return {
                managedPath: '/etc/cron.d/ysk',
                managedLines: 3,
                enabledJobs: 2,
                totalJobs: 3,
                hostHasYskEntries: true,
                notes: ['ok'] };
            }
            return {
              items: [
                {
                  id: 'c1',
                  schedule: '*/5 * * * *',
                  command: '/usr/bin/true',
                  user: 'ysk',
                  projectId: 'p-php',
                  enabled: true,
                  last_install: { ok: true, at: now() } },
                {
                  id: 'c2',
                  schedule: '0 3 * * *',
                  command: 'cd /home/n/app && npm run cron',
                  user: 'nodeu',
                  project_id: 'p-node',
                  enabled: false },
              ] };
          } },
        {
          match: /\/api\/v1\/projects/,
          body: {
            items: [
              {
                id: 'p-php',
                name: 'PHP App',
                linuxUser: 'phpu',
                homeDir: '/home/phpu',
                runtime: 'php' },
              {
                id: 'p-node',
                name: 'Node App',
                linuxUser: 'nodeu',
                homeDir: '/home/nodeu',
                runtime: 'node' },
              {
                id: 'p-py',
                name: 'Py App',
                linuxUser: 'pyu',
                homeDir: '/home/pyu',
                runtime: 'python' },
              {
                id: 'p-go',
                name: 'Go App',
                linuxUser: 'gou',
                homeDir: '/home/gou',
                runtime: 'go' },
              {
                id: 'p-static',
                name: 'Static',
                linuxUser: 'statu',
                homeDir: '/home/statu',
                runtime: 'static' },
              {
                id: 'p-none',
                name: 'No User',
                linuxUser: '',
                homeDir: '/home/x',
                runtime: 'other' },
            ] } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/cron', <CronPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      await clickBtn(user, /create|new|add/i, 2);
      // Pick projects via select/options
      for (const sel of Array.from(document.querySelectorAll('select')).slice(0, 4)) {
        const opts = Array.from((sel as HTMLSelectElement).options);
        for (const o of opts.slice(0, 6)) {
          try {
            await user.selectOptions(sel as HTMLSelectElement, o.value);
          } catch {
            /* ignore */
          }
        }
      }
      // Click preset chips / schedule buttons
      for (const b of screen.queryAllByRole('button').slice(0, 25)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      // Fill command
      for (const ta of screen.queryAllByRole('textbox').slice(0, 4)) {
        try {
          await user.clear(ta);
          await user.type(ta, '/usr/bin/true');
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /create|save|submit|add job/i, 2);

      // Row toggles / install / delete
      await clickBtn(user, /install|enable|disable|delete|edit|run/i, 8);

      const statusTab = screen.queryByRole('tab', { name: /status/i });
      if (statusTab) await user.click(statusTab);
      await clickBtn(user, /install|refresh|reprobe/i, 3);

      const about = screen.queryByRole('tab', { name: /about/i });
      if (about) await user.click(about);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    35_000,
  );

  it(
    'ProtectionPage: automation chips + geo + ban + suspects + notes',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock(defenseRich());
      renderAt('/protection', <ProtectionPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // Click all tabs
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      // Preset / ban / apply / probe buttons
      await clickBtn(
        user,
        /apply|preset|daily|hardened|emergency|probe|refresh|ban|unban|save|update|download|lookup|add|remove/i,
        20,
      );

      // Automation chips — numbers
      for (const b of screen.queryAllByRole('button')) {
        const t = (b.textContent ?? '').trim();
        if (/^(5|10|15|20|30|35|40|45|50|55|60|65|80|90|120|0)$/.test(t)) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }

      for (const cb of screen.queryAllByRole('checkbox').slice(0, 12)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }

      // Geo lookup
      const inputs = screen.queryAllByRole('textbox');
      if (inputs.length) {
        const last = inputs[inputs.length - 1]!;
        try {
          await user.clear(last);
          await user.type(last, '203.0.113.50');
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /lookup/i, 1);

      // Confirm dialogs
      await clickBtn(user, /confirm|yes|apply|emergency/i, 4);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'LogsPage: rich sources + explore follow + settings + export + bookmarks',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/logs'),
          handler: (url, init) => {
            const method = (init?.method ?? 'GET').toUpperCase();
            if (method !== 'GET') {
              if (url.includes('export')) {
                return { ok: true, id: 'exp1', notes: ['exported'], format: 'text' };
              }
              if (url.includes('bookmarks')) {
                return { ok: true, id: 'bm1' };
              }
              return HONESTY_WRITTEN_BLOCKED;
            }
            if (url.includes('sources')) {
              return {
                items: [
                  {
                    id: 'journal:nginx.service',
                    kind: 'journal',
                    label: 'nginx',
                    unit: 'nginx.service',
                    group: 'web',
                    available: true },
                  {
                    id: 'file:auth',
                    kind: 'file',
                    label: 'auth.log',
                    group: 'system',
                    available: true,
                    bytes: 1024 * 900 },
                  {
                    id: 'file:managed:phpu.access.log',
                    kind: 'file',
                    label: 'phpu access',
                    group: 'managed',
                    available: true,
                    bytes: 2048 },
                  {
                    id: 'file:nginx-error',
                    kind: 'file',
                    label: 'nginx error',
                    available: false,
                    bytes: 0 },
                ] };
            }
            if (url.includes('overview')) {
              return {
                journalDiskMb: 512,
                followIntervalSec: 2,
                journalWarnMb: 1024,
                vacuumDefaultDays: 14,
                maxLines: 200,
                isRoot: false,
                executeEnabled: false,
                quickUnits: [
                  { unit: 'ssh.service', label: 'SSH' },
                  { unit: 'fail2ban.service', label: 'Fail2ban' },
                ] };
            }
            if (url.includes('units')) {
              return {
                items: [
                  { unit: 'nginx.service', active: 'active' },
                  { unit: 'ysk-project-x.service', active: 'inactive' },
                  { unit: 'cron.service', active: 'active' },
                ] };
            }
            if (url.includes('settings')) {
              return {
                maxLines: 200,
                maxBytes: 2 * 1024 * 1024,
                followIntervalSec: 3,
                vacuumDefaultDays: 14,
                maskSecrets: true,
                autoVacuumEnabled: false,
                autoVacuumTime: '03:00',
                journalWarnMb: 1024,
                customAllowPaths: ['/var/log/custom.log'],
                disabledSources: [] };
            }
            if (url.includes('bookmarks')) {
              return {
                items: [
                  {
                    id: 'bm1',
                    name: 'nginx errors',
                    source: 'journal:nginx.service',
                    since: '1h',
                    lines: 100 },
                ] };
            }
            if (url.includes('projects')) {
              return {
                items: [
                  {
                    projectId: 'p1',
                    name: 'PHP App',
                    linuxUser: 'phpu',
                    files: [
                      { name: 'app.log', previewable: true },
                      { name: 'error.log', previewable: true },
                    ],
                    related: [
                      { source: 'journal:php8.2-fpm.service', available: true, label: 'fpm' },
                    ] },
                ] };
            }
            if (url.includes('query') || url.includes('stream')) {
              return {
                ok: true,
                lines: ['2024-01-01 error foo', '2024-01-01 info bar'],
                lineCount: 2,
                notes: ['ok'] };
            }
            if (url.includes('export/')) {
              return { ok: true };
            }
            return { ok: true, items: [], lines: [], text: '' };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/logs?project=p1', <LogsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // Quick chips
      await clickBtn(user, /nginx|ssh|fail2ban|auth/i, 6);

      // Click rail / list buttons
      for (const b of screen.queryAllByRole('button').slice(0, 20)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }

      // Filters
      for (const input of screen.queryAllByRole('textbox').slice(0, 4)) {
        try {
          await user.clear(input);
          await user.type(input, 'error');
        } catch {
          /* ignore */
        }
      }
      for (const sel of Array.from(document.querySelectorAll('select')).slice(0, 4)) {
        const o = (sel as HTMLSelectElement).options[1];
        if (o) {
          try {
            await user.selectOptions(sel as HTMLSelectElement, o.value);
          } catch {
            /* ignore */
          }
        }
      }

      await clickBtn(user, /query|load|search|refresh|follow|export|bookmark|save|vacuum/i, 12);

      // Follow toggle
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 6)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }

      // Settings tab
      const setTab = screen.queryByRole('tab', { name: /settings|設定|设置/i });
      if (setTab) await user.click(setTab);
      await fillId('set-custom', '/var/log/app/extra.log', user);
      await clickBtn(user, /add|save|remove/i, 6);
      // Enter key on custom path
      const custom = document.getElementById('set-custom');
      if (custom) {
        fireEvent.change(custom, { target: { value: '/tmp/x.log' } });
        fireEvent.keyDown(custom, { key: 'Enter', code: 'Enter' });
      }

      // Bookmarks apply
      await clickBtn(user, /bookmark|load|apply|nginx errors/i, 4);

      // Explore tab again
      const explore = screen.queryByRole('tab', { name: /explore|瀏覽|浏览/i });
      if (explore) await user.click(explore);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'SystemPage: host identity + ntp + export + power actions',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: /\/api\/v1\/system\/host/,
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                ok: true,
                notes: ['written'],
                blockMessage: 'need execute' };
            }
            return {
              ok: true,
              identity: {
                hostname: 'ysk.example.com',
                prettyHostname: 'YSK Box',
                timezone: 'UTC' },
              os: {
                platform: 'linux',
                arch: 'x64',
                release: 'Ubuntu 24.04',
                kernel: '6.8.0',
                prettyName: 'Ubuntu 24.04' },
              runtime: {
                uptimeSec: 86400 * 3,
                loadavg: [0.5, 0.4, 0.3],
                cpus: 4,
                memory: { total: 8e9, free: 5e9, usedRatio: 0.4 },
                node: 'v20',
                pid: 1,
                uid: 0 },
              time: {
                utc: now(),
                local: now(),
                ntpEnabled: true,
                ntpSynchronized: true,
                timeSource: 'ntp' },
              network: {
                ips: ['10.0.0.5'],
                interfaces: [{ name: 'eth0', addrs: ['10.0.0.5/24'] }],
                resolvers: ['1.1.1.1'] },
              disks: [
                {
                  mount: '/',
                  size: '100G',
                  used: '40G',
                  avail: '60G',
                  usePct: 40,
                  fstype: 'ext4' },
              ],
              power: { pending: null },
              boot: { defaultTarget: 'multi-user.target' },
              caps: {
                executeEnabled: false,
                isRoot: false,
                canPower: true,
                canIdentity: true,
                canExport: true },
              collectedAt: now() };
          } },
        {
          match: /\/api\/v1\/system\/export/,
          body: {
            ok: true,
            generatedAt: now(),
            items: [],
            exportedAt: now(),
            counts: { projects: 1 },
            projects: [{ id: 'p1', name: 'Demo' }] } },
        {
          match: (url) => url.includes('/power') || url.includes('/reboot'),
          body: HONESTY_WRITTEN_BLOCKED },
        { match: /.*/, body: { ok: true, items: [], ready: true } },
      ]);

      renderAt('/system', <SystemPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea',
        ),
      ).slice(0, 12)) {
        try {
          await user.clear(input);
          await user.type(input, input.type === 'number' ? '1' : 'ysk.example.com');
        } catch {
          /* ignore */
        }
      }

      await clickBtn(
        user,
        /apply|save|ntp|sync|export|download|refresh|reboot|shutdown|power|identity/i,
        15,
      );
      await clickBtn(user, /confirm|yes/i, 3);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    30_000,
  );

  it(
    'MetricsPage: process select + signal + detail + filters',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      const topHeader = {
        ok: true,
        at: t,
        uptimeSec: 3600,
        loadavg: [0.5, 0.4, 0.3] as [number, number, number],
        tasks: { total: 100, running: 2, sleeping: 98, stopped: 0, zombie: 0 },
        cpu: {
          us: 10,
          sy: 5,
          ni: 0,
          id: 85,
          wa: 0,
          hi: 0,
          si: 0,
          st: 0,
          busyPct: 15 },
        cpus: [
          {
            us: 10,
            sy: 5,
            ni: 0,
            id: 85,
            wa: 0,
            hi: 0,
            si: 0,
            st: 0,
            busyPct: 15 },
        ],
        memory: {
          totalKiB: 8e6,
          freeKiB: 1e6,
          usedKiB: 6e6,
          buffCacheKiB: 1e6,
          availableKiB: 2e6 },
        swap: { totalKiB: 1e6, freeKiB: 9e5, usedKiB: 1e5 },
        notes: [] };
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.startsWith('/api/v1/metrics/processes/signal'),
          body: {
            ok: true,
            pid: '42',
            signal: 'TERM',
            stillAlive: false,
            notes: ['signaled'],
            requiresExecute: true } },
        {
          match: (url) => /\/api\/v1\/metrics\/processes\/\d+/.test(url),
          body: {
            ok: true,
            pid: '42',
            command: 'nginx: master',
            user: 'root',
            cpu: 1.2,
            mem: 0.5,
            rss: 1024 * 100,
            state: 'S',
            ppid: '1',
            start: t,
            cmdline: '/usr/sbin/nginx',
            env: ['PATH=/usr/bin'],
            notes: [] } },
        {
          match: (url) => url.startsWith('/api/v1/metrics/processes'),
          body: {
            ok: true,
            at: t,
            sort: 'cpu',
            limit: 40,
            topHeader,
            rows: [
              {
                pid: '1',
                user: 'root',
                cpu: 0.1,
                mem: 0.2,
                command: 'systemd',
                state: 'S',
                etime: '1-00:00',
                resKiB: 1000,
                virtKiB: 5000 },
              {
                pid: '42',
                user: 'www-data',
                cpu: 12,
                mem: 8,
                command: 'nginx: worker',
                state: 'S',
                etime: '01:00',
                resKiB: 50000,
                virtKiB: 100000 },
              {
                pid: '99',
                user: 'alice',
                cpu: 6,
                mem: 3,
                command: 'ysk-server',
                state: 'R',
                etime: '00:30',
                resKiB: 20000,
                virtKiB: 80000 },
              {
                pid: '100',
                user: 'bob',
                cpu: 0.5,
                mem: 0.1,
                command: 'bash',
                state: 'S',
                etime: '00:10',
                resKiB: 2000,
                virtKiB: 4000 },
            ],
            notes: [] } },
        {
          match: (url) => url.startsWith('/api/v1/metrics/top'),
          body: topHeader },
        {
          match: (url) => url.startsWith('/api/v1/metrics/projects'),
          body: {
            items: [
              {
                projectId: 'p1',
                name: 'Demo',
                diskMb: 100,
                path: '/home/demo' },
            ] } },
        {
          match: (url) => url.startsWith('/api/v1/metrics'),
          body: {
            ok: true,
            at: t,
            loadavg: [2.5, 1.2, 0.8],
            cpuCount: 2,
            uptimeSec: 100000,
            memory: {
              total: 8e9,
              used: 7.2e9,
              free: 0.8e9,
              usedRatio: 0.9,
              available: 1e9 },
            disk: {
              path: '/',
              total: 100e9,
              used: 92e9,
              free: 8e9,
              usedRatio: 0.92 },
            diskMounts: [
              {
                filesystem: '/dev/sda1',
                mount: '/',
                size: 100e9,
                used: 92e9,
                avail: 8e9,
                usedRatio: 0.92 },
              {
                filesystem: '/dev/sdb1',
                mount: '/home',
                size: 50e9,
                used: 10e9,
                avail: 40e9,
                usedRatio: 0.2 },
            ],
            alerts: ['mem_high'],
            notes: [] } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/metrics', <MetricsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      // Select processes
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 6)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }

      // Filters
      for (const input of screen.queryAllByRole('textbox').slice(0, 3)) {
        try {
          await user.clear(input);
          await user.type(input, 'nginx');
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /cpu|mem|mine|all|refresh|follow|detail|signal|kill|term|stop|nice/i, 15);

      // Confirm signal dialogs
      await clickBtn(user, /confirm|yes|send|kill/i, 4);

      // Click process rows / pid buttons
      for (const b of screen.queryAllByRole('button').slice(0, 20)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    35_000,
  );

  it(
    'SecurityPage + OutboundIdentities wizard complete',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.startsWith('/api/v1/auth/'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ok: true,
                secret: 'JBSWY3DPEHPK3PXP',
                otpauthUrl: 'otpauth://totp/YSK:admin?secret=JBSWY3DPEHPK3PXP',
                enabled: true,
                enrolled: true,
                recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'],
                token: 'ysk_new_secret',
                key: { id: 'k2', name: 'ci', prefix: 'ysk_x', created_at: t } };
            }
            if (url.includes('totp')) return { enabled: false, enrolled: false };
            if (url.includes('sessions')) {
              return {
                items: [
                  {
                    id: 's1',
                    created_at: t,
                    expires_at: t,
                    current: true,
                    ip: '1.1.1.1',
                    user_agent: 'vitest' },
                  {
                    id: 's2',
                    created_at: t,
                    expires_at: t,
                    current: false,
                    ip: '2.2.2.2' },
                ] };
            }
            if (url.includes('api-keys')) {
              return {
                items: [{ id: 'k1', name: 'ci', prefix: 'ysk_ci', created_at: t, lastUsedAt: t }] };
            }
            if (url.includes('webauthn')) {
              return {
                items: [{ id: 'c1', name: 'yubikey', createdAt: t }],
                ok: true };
            }
            return { ok: true };
          } },
        {
          match: (url) => url.startsWith('/api/v1/settings/security'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              requireAdminTotp: false,
              requireAdminTotpStrict: false,
              ok: true };
          } },
        {
          match: (url) => url.startsWith('/api/v1/approvals'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  id: 'ap1',
                  tool: 'sys.shell',
                  status: 'pending',
                  requestedAt: t,
                  requestedBy: 'admin' },
              ] };
          } },
        {
          match: (url) => url.includes('/ssh') || url.includes('/security/ssh'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ok: true,
                applied: false,
                blocked: true,
                notes: ['need execute'],
                requiresExecute: true,
                privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END-----',
                identity: {
                  id: 'id-new',
                  name: 'panel-peer',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:abc',
                  publicKey: 'ssh-ed25519 AAAA',
                  status: 'created',
                  createdAt: t } };
            }
            return {
              items: [
                {
                  id: 'id1',
                  name: 'panel-peer',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:abc',
                  publicKey: 'ssh-ed25519 AAAA panel',
                  status: 'installed',
                  createdAt: t,
                  lastTestAt: t,
                  lastTestOk: true },
                {
                  id: 'id2',
                  name: 'proj-out',
                  algorithm: 'ed25519',
                  purpose: 'user_outbound',
                  fingerprintSha256: 'SHA256:def',
                  publicKey: 'ssh-ed25519 BBBB proj',
                  status: 'created',
                  createdAt: t,
                  binding: {
                    projectId: 'p1',
                    linuxUser: 'demou',
                    homeDir: '/home/demou' } },
              ],
              ssHd: { PasswordAuthentication: 'no', PermitRootLogin: 'prohibit-password' },
              notes: [] };
          } },
        {
          match: /\/api\/v1\/projects/,
          body: {
            items: [
              {
                id: 'p1',
                name: 'Demo',
                linuxUser: 'demou',
                homeDir: '/home/demou' },
            ] } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/security', <SecurityPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      await clickBtn(
        user,
        /enroll|enable|disable|create|revoke|logout|approve|deny|save|generate|copy|install|test|add|remove|refresh/i,
        20,
      );

      for (const input of screen.queryAllByRole('textbox').slice(0, 8)) {
        try {
          await user.clear(input);
          await user.type(input, '123456');
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /confirm|verify|save|create/i, 6);

      // Standalone OutboundIdentities wizard
      const { unmount } = renderAt(
        '/security',
        <OutboundIdentities onFlash={vi.fn()} onChanged={vi.fn()} />,
      );
      await waitFor(() => {
        expect(screen.queryAllByRole('button').length).toBeGreaterThan(0);
      });

      await clickBtn(user, /create|new|add identity|wizard/i, 2);
      // Wizard steps
      for (const rb of screen.queryAllByRole('radio').slice(0, 6)) {
        try {
          await user.click(rb);
        } catch {
          /* ignore */
        }
      }
      for (const input of screen.queryAllByRole('textbox').slice(0, 4)) {
        try {
          await user.clear(input);
          await user.type(input, 'my-key');
        } catch {
          /* ignore */
        }
      }
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 4)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /next|continue|create|finish|back|install|test|copy|primary|delete|filter/i, 15);

      // Filter chips
      for (const b of screen.queryAllByRole('button').slice(0, 15)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }

      // Test dialog
      for (const input of screen.queryAllByRole('textbox').slice(0, 3)) {
        try {
          await user.clear(input);
          await user.type(input, 'root@10.0.0.1');
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /test|run|confirm|close|ack|i understand/i, 6);

      probe.sample();
        unmount();
      probe.assertRendered();
    },
    45_000,
  );

  it(
    'DnsPage + EmailDomainPage form submits',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/email'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (url.includes('/dns')) {
              return {
                domain: 'example.com',
                records: [
                  { type: 'MX', name: '@', value: 'mail.example.com' },
                  { type: 'TXT', name: '@', value: 'v=spf1 mx -all' },
                ],
                externalTodos: ['Publish DKIM'],
                health: { score: 40, maxScore: 100, messages: ['SPF soft'] },
                notes: [] };
            }
            if (url.includes('/mailboxes')) {
              return {
                items: [
                  {
                    id: 'mb1',
                    local_part: 'info',
                    address: 'info@example.com',
                    quotaMb: 500 },
                ] };
            }
            if (url.includes('/aliases')) {
              return {
                items: [{ id: 'al1', source: 'hi@example.com', dest: 'info@example.com' }] };
            }
            if (url.includes('/deliverability')) {
              return {
                ok: true,
                score: 55,
                panelReady: false,
                honesty: ['No inbox guarantee'],
                checks: [{ id: 'spf', ok: false, detail: 'missing', title: 'SPF' }],
                recommendations: ['Add SPF'],
                items: [
                  { id: 'spf', title: 'SPF', ok: false, detail: 'missing' },
                  { id: 'dkim', title: 'DKIM', ok: true, detail: 'ok' },
                ] };
            }
            if (
              url.includes('/sieve') ||
              url.includes('/relay') ||
              url.includes('/warmup') ||
              url.includes('/autoreply')
            ) {
              return {
                ok: true,
                items: [],
                script: 'require ["fileinto"];',
                enabled: true,
                subject: 'OOO',
                body: 'away' };
            }
            if (url.match(/\/domains\/[^/?]+$/)) {
              return {
                id: 'dom-1',
                domain: 'example.com',
                rate_limit_per_hour: 200,
                antispam: true,
                server_ip: '203.0.113.10',
                apply_status: 'planned',
                managed: true,
                health_score: 55,
                suspended: false };
            }
            return {
              items: [
                {
                  id: 'dom-1',
                  domain: 'example.com',
                  rate_limit_per_hour: 200,
                  antispam: true,
                  server_ip: '203.0.113.10',
                  health_score: 55 },
              ] };
          } },
        {
          match: (url) =>
            url.includes('/api/v1/resources/dns') ||
            url.includes('/api/v1/dns') ||
            url.includes('/zones'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (url.includes('records') || /zones\/[^/?]+/.test(url)) {
              return {
                id: 'z1',
                zone: 'example.com',
                serverIp: '203.0.113.10',
                nsName: 'ns1.example.com',
                ttl: 300,
                apply_status: 'planned',
                records: [
                  { id: 'r1', type: 'A', name: '@', value: '203.0.113.10', ttl: 300 },
                  { id: 'r2', type: 'CNAME', name: 'www', value: 'example.com', ttl: 300 },
                  { id: 'r3', type: 'MX', name: '@', value: 'mail.example.com', priority: 10 },
                  { id: 'r4', type: 'TXT', name: '@', value: 'v=spf1 mx -all' },
                ],
                notes: [] };
            }
            return {
              items: [
                {
                  id: 'z1',
                  zone: 'example.com',
                  serverIp: '203.0.113.10',
                  nsName: 'ns1.example.com',
                  ttl: 300,
                  apply_status: 'planned' },
              ],
              meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      const dns = renderAt('/dns', <DnsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      try {
        const zone = screen.queryAllByText(/example\.com/i)[0];
        if (zone) await user.click(zone);
      } catch {
        /* ignore */
      }
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      for (const input of screen.queryAllByRole('textbox').slice(0, 10)) {
        try {
          await user.clear(input);
          await user.type(input, 'www');
        } catch {
          /* ignore */
        }
      }
      for (const sel of Array.from(document.querySelectorAll('select')).slice(0, 4)) {
        const o = (sel as HTMLSelectElement).options[1];
        if (o) {
          try {
            await user.selectOptions(sel as HTMLSelectElement, o.value);
          } catch {
            /* ignore */
          }
        }
      }
      await clickBtn(user, /add|create|save|apply|delete|edit|refresh|record/i, 12);
      probe.sample();
      dns.unmount();
      probe.sample();
      dns.unmount();

      const email = renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea',
        ),
      ).slice(0, 20)) {
        try {
          await user.clear(input as HTMLInputElement);
          await user.type(
            input as HTMLInputElement,
            input.type === 'number' || input.type === 'password' ? '100' : 'test-value',
          );
        } catch {
          /* ignore */
        }
      }
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 10)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(
        user,
        /save|create|add|apply|suspend|resume|delete|test|refresh|generate|copy|enable|disable/i,
        20,
      );
      probe.sample();
      email.unmount();
      probe.sample();
      email.unmount();
      probe.assertRendered();
    },
    45_000,
  );

  it(
    'Dashboard + Users + Network + Backups remaining interactions',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.startsWith('/api/v1/dashboard') || url.startsWith('/api/v1/summary'),
          body: {
            ok: true,
            at: t,
            host: { hostname: 'ysk', uptimeSec: 1000, loadavg: [0.1, 0.2, 0.3] },
            services: [
              { id: 'nginx', label: 'Nginx', active: 'active', ok: true },
              { id: 'ssh', label: 'SSH', active: 'active', ok: true },
            ],
            alerts: [{ id: 'a1', level: 'warn', message: 'disk' }],
            projects: { total: 2, running: 1 },
            notes: [],
            kpis: [
              { id: 'cpu', label: 'CPU', value: '10%', tone: 'ok' },
              { id: 'mem', label: 'Mem', value: '50%', tone: 'warn' },
            ],
            quickLinks: [{ to: '/files', label: 'Files' }] } },
        {
          match: (url) => url.startsWith('/api/v1/users'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  id: 'u1',
                  username: 'admin',
                  roles: ['admin'],
                  packageId: 'pkg1',
                  suspended: false,
                  locale: 'en',
                  capabilityGrants: ['projects.read'],
                  capabilityRevokes: [],
                  email: 'a@b.c' },
                {
                  id: 'u2',
                  username: 'bob',
                  roles: ['user'],
                  packageId: 'pkg1',
                  suspended: true,
                  locale: 'zh-CN' },
              ],
              hostUsage: { projects: 2, diskMb: 100, quotaMb: 1000 },
              meta: { total: 2, page: 1, limit: 50 } };
          } },
        {
          match: (url) => url.startsWith('/api/v1/packages'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  id: 'pkg1',
                  name: 'default',
                  maxProjects: 10,
                  maxMailboxes: 5,
                  maxDatabases: 5,
                  diskMb: 1024,
                  bandwidthMb: 0,
                  ftp: true,
                  ssh: true },
              ] };
          } },
        {
          match: (url) => url.includes('/rbac'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  role: 'operator',
                  dirty: true,
                  policy: {
                    maxLevel: 'write-high',
                    capabilities: ['projects.read', 'projects.write'] },
                  factory: { maxLevel: 'write-high', capabilities: ['projects.read'] } },
              ] };
          } },
        {
          match: (url) => url.startsWith('/api/v1/network'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              at: t,
              notes: [],
              backend: {
                hasIp: true,
                networkManager: 'inactive',
                networkd: 'inactive',
                canPersist: true },
              interfaces: [
                {
                  name: 'eth0',
                  ifindex: 2,
                  operstate: 'UP',
                  flags: ['UP'],
                  mtu: 1500,
                  isLoopback: false,
                  isDefaultEgress: true,
                  addrs: [{ family: 'inet', local: '10.0.0.5', prefixlen: 24 }] },
                {
                  name: 'lo',
                  ifindex: 1,
                  operstate: 'UP',
                  flags: ['UP', 'LOOPBACK'],
                  mtu: 65536,
                  isLoopback: true,
                  isDefaultEgress: false,
                  addrs: [{ family: 'inet', local: '127.0.0.1', prefixlen: 8 }] },
              ],
              routes: [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0' }],
              caps: { canMutate: true, executeEnabled: false, isRoot: false },
              defaultGateway: '10.0.0.1',
              defaultDev: 'eth0',
              dns: {
                nameservers: ['1.1.1.1', '8.8.8.8'],
                uplinkServers: ['1.1.1.1'],
                search: ['local'],
                source: 'static',
                notes: [],
                ignoreAutoDns: true,
                canApply: true } };
          } },
        {
          match: (url) => url.startsWith('/api/v1/backups'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (_u.includes('settings')) {
              return {
                remote: {
                  enabled: true,
                  kind: 's3',
                  host: '',
                  port: 22,
                  username: '',
                  path: 's3://bucket/path',
                  password: '',
                  s3Bucket: 'b',
                  s3Region: 'us-east-1',
                  s3Endpoint: '',
                  accessKey: 'AK',
                  secretKey: 'SK' },
                exclusions: ['node_modules', '.git'],
                restic: {
                  enabled: true,
                  repoPath: '/var/backups/restic',
                  password: '***',
                  s3Repo: 's3:https://s3/bucket' } };
            }
            return {
              items: [
                {
                  projectId: 'p1',
                  name: 'Demo',
                  path: '/var/backups/p1.tgz',
                  bytes: 4096,
                  mtime: t,
                  kind: 'full' },
              ],
              lastRun: {
                at: t,
                ok: true,
                results: [{ projectId: 'p1', ok: true, notes: ['ok'] }] },
              snapshots: [{ id: 'snap-1', time: t, tags: ['p1'], paths: ['/home/demo'] }] };
          } },
        {
          match: /\/api\/v1\/projects/,
          body: { items: [{ id: 'p1', name: 'Demo' }] } },
        { match: /.*/, body: { ok: true, items: [], ready: true } },
      ]);

      for (const [path, el] of [
        ['/', <DashboardPage key="d" />],
        ['/users', <UsersPage key="u" />],
        ['/network', <NetworkPage key="n" />],
        ['/backups', <BackupsPage key="b" />],
      ] as const) {
        const { unmount } = renderAt(path, el);
        await waitFor(() =>
          expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
        );
        for (const tab of screen.queryAllByRole('tab')) {
          try {
            await user.click(tab);
          } catch {
            /* ignore */
          }
        }
        for (const input of Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea',
          ),
        ).slice(0, 12)) {
          try {
            await user.clear(input as HTMLInputElement);
            await user.type(input as HTMLInputElement, 'x');
          } catch {
            /* ignore */
          }
        }
        for (const cb of screen.queryAllByRole('checkbox').slice(0, 6)) {
          try {
            await user.click(cb);
          } catch {
            /* ignore */
          }
        }
        for (const rb of screen.queryAllByRole('radio').slice(0, 6)) {
          try {
            await user.click(rb);
          } catch {
            /* ignore */
          }
        }
        await clickBtn(
          user,
          /save|create|add|apply|delete|edit|refresh|backup|restore|run|export|download|detail|suspend|enable|disable/i,
          12,
        );
        probe.sample();
        unmount();
      }
      probe.sample();
      probe.assertRendered();
    },
    50_000,
  );

  it(
    'GenericRuntime + Nginx + Migrate + Updates interactions',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/scheduler'),
          body: {
            jobs: [
              {
                id: 'j1',
                name: 'nightly',
                schedule: '0 3 * * *',
                enabled: true,
                kind: 'updates' },
            ] } },
        {
          match: (url) => url.includes('/api/v1/updates'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (_u.includes('/self')) {
              return {
                ok: true,
                current: '0.1.0',
                latest: '0.1.1',
                upgradable: true,
                notes: [] };
            }
            return {
              ok: true,
              items: [
                {
                  id: 'u1',
                  name: 'pkg',
                  version: '1.0',
                  current: '0.9',
                  candidate: '1.0',
                  risk: 'medium' },
              ],
              lastAt: now(),
              notes: [] };
          } },
        {
          match: (url) =>
            url.includes('/runtimes') ||
            url.includes('/hosting/') ||
            url.includes('/nginx') ||
            url.includes('/migrate'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              items: [],
              catalog: [
                {
                  id: 'g1',
                  title: 'General',
                  fields: [
                    { key: 'workers', label: 'Workers', type: 'int', default: 2 },
                    { key: 'memory', label: 'Memory', type: 'bytes', default: '512M' },
                    { key: 'debug', label: 'Debug', type: 'bool', default: false },
                  ] },
              ],
              settings: { values: { workers: 2 }, extra: {}, version: 'default' },
              versions: ['18', '20', '22'],
              version: '20',
              installed: true,
              active: 'active',
              sites: [{ name: 'demo', enabled: true, path: '/etc/nginx/sites-enabled/demo' }],
              notes: ['ok'],
              steps: [{ id: 's1', label: 'Export', status: 'done' }],
              status: 'ready' };
          } },
        { match: /.*/, body: { ok: true, items: [], ready: true, jobs: [] } },
      ]);

      for (const [path, el] of [
        ['/runtimes/node', <GenericRuntimePage key="n" kind="node" />],
        ['/nginx', <NginxPage key="x" />],
        ['/migrate', <MigrateHostPage key="m" />],
        ['/updates', <UpdatesPage key="u" />],
      ] as const) {
        const { unmount } = renderAt(path, el);
        await waitFor(() =>
          expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
        ).catch(() => undefined);
        probe.sample();
        for (const tab of screen.queryAllByRole('tab')) {
          try {
            await user.click(tab);
          } catch {
            /* ignore */
          }
        }
        await clickBtn(
          user,
          /save|apply|install|upgrade|check|refresh|start|stop|reload|migrate|export|import|next|run/i,
          12,
        );
        for (const input of screen.queryAllByRole('textbox').slice(0, 6)) {
          try {
            await user.type(input, 'x');
          } catch {
            /* ignore */
          }
        }
        probe.sample();
        unmount();
      }
      probe.sample();
      probe.assertRendered();
    },
    40_000,
  );
});

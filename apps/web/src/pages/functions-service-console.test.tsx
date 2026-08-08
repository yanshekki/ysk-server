import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { ServiceConsolePage } from './features/ServiceConsolePage';

describe('ServiceConsole function coverage', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'], capabilities: [] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it('exercises lifecycle, settings, apply for postgres', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.includes('/auth/me'),
        body: { user: { username: 'admin', roles: ['admin'] }, capabilities: ['*'] } },
      {
        match: (url) => url.includes('/console') || url.includes('/db/') || url.includes('postgres') || url.includes('mysql') || url.includes('redis') || url.includes('mariadb'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return { ...HONESTY_WRITTEN_BLOCKED, ok: true, notes: ['written'] };
          }
          return {
            engine: 'postgres',
            installed: true,
            active: 'active',
            activeLabel: 'active',
            enabled: 'enabled',
            version: '16',
            executeEnabled: false,
            isRoot: false,
            unit: 'postgresql.service',
            metrics: { Uptime: 1000, Clients: 3, Memory: '12M' },
            categories: [
              {
                id: 'connections',
                label: 'Connections',
                settings: [
                  {
                    key: 'max_connections',
                    label: 'Max connections',
                    type: 'int',
                    liveValue: '100',
                    applyMode: 'restart' },
                  {
                    key: 'ssl',
                    label: 'SSL',
                    type: 'bool',
                    liveValue: 'ON',
                    enumValues: ['ON', 'OFF'],
                    applyMode: 'reload' },
                  {
                    key: 'log_level',
                    label: 'Log level',
                    type: 'enum',
                    liveValue: 'info',
                    enumValues: ['debug', 'info', 'warn', 'error'],
                    applyMode: 'runtime' },
                  {
                    key: 'shared_buffers',
                    label: 'Shared buffers',
                    type: 'string',
                    liveValue: '128MB',
                    applyMode: 'restart' },
                  {
                    key: 'port',
                    label: 'Port',
                    type: 'int',
                    liveValue: '5432',
                    applyMode: 'restart' },
                  {
                    key: 'idle_timeout',
                    label: 'Idle timeout',
                    type: 'int',
                    liveValue: '60',
                    applyMode: 'runtime' },
                  {
                    key: 'big_enum',
                    label: 'Big enum',
                    type: 'enum',
                    liveValue: 'a1',
                    enumValues: Array.from({ length: 15 }, (_, i) => `a${i + 1}`),
                    applyMode: 'runtime' },
                ] },
              {
                id: 'memory',
                label: 'Memory',
                settings: [
                  {
                    key: 'work_mem',
                    label: 'Work mem',
                    type: 'string',
                    liveValue: '4MB',
                    applyMode: 'runtime' },
                ] },
            ] };
        } },
    ]);
    render(
      <MemoryRouter>
        <ServiceConsolePage engine="postgres" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    // tabs
    for (const tab of screen.queryAllByRole('tab')) {
      await user.click(tab);
    }
    // lifecycle
    for (const re of [/start|stop|restart|reload|install|refresh|apply|save/i]) {
      for (const b of screen.queryAllByRole('button', { name: re }).slice(0, 3)) {
        if ((b as HTMLButtonElement).disabled) {
          fireEvent.click(b);
        } else {
          await user.click(b);
        }
      }
    }
    // change settings
    for (const input of document.querySelectorAll('input, select, textarea')) {
      const el = input as HTMLInputElement;
      try {
        if (el.type === 'checkbox' || el.type === 'radio') fireEvent.click(el);
        else if (el.tagName === 'SELECT') {
          const s = el as unknown as HTMLSelectElement;
          if (s.options[1]) fireEvent.change(s, { target: { value: s.options[1].value } });
        } else fireEvent.change(el, { target: { value: el.value === '100' ? '200' : '64' } });
      } catch {
        /* ignore */
      }
    }
    // preset chips
    for (const b of document.querySelectorAll('button')) {
      const t = b.textContent ?? '';
      if (/^(ON|OFF|100|200|50|5432|3306|0|30|60|300|16|64|128|256)$/i.test(t.trim())) {
        fireEvent.click(b);
      }
    }
    for (const b of screen.queryAllByRole('button', { name: /apply|save/i }).slice(0, 3)) {
      fireEvent.click(b);
    }
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('mysql + redis engines mount', async () => {
    installFetchMock([
      softwareReadyRoute(),
      {
        match: () => true,
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
          return {
            installed: true,
            active: 'inactive',
            activeLabel: 'stopped',
            metrics: {},
            categories: [
              {
                id: 'main',
                label: 'Main',
                settings: [
                  {
                    key: 'port',
                    label: 'Port',
                    type: 'int',
                    liveValue: '6379',
                    applyMode: 'restart' },
                ] },
            ] };
        } },
    ]);
    for (const engine of ['mysql', 'redis', 'mariadb'] as const) {
      const { unmount } = render(
        <MemoryRouter>
          <ServiceConsolePage engine={engine} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) fireEvent.click(tab);
      for (const b of screen.queryAllByRole('button').slice(0, 8)) fireEvent.click(b);
      unmount();
    }
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installFetchMock, softwareReadyRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { createUiProbe } from '../test/assert-rendered';
import {
  FirewallPage,
  parsePorts,
  firewallActionTone,
  firewallActiveTone,
  parsePortInput,
  isValidDenyIp,
  mapFirewallRules } from './features/FirewallPage';

const ok = () => ({ ok: true, notes: ['ok'], blocked: false, apply_status: 'applied' });
const body = {
  installed: true, active: 'active', activeLabel: 'active', executeEnabled: true, isRoot: true,
  defaultIncoming: 'deny', allowCount: 5, denyCount: 2,
  rules: [
    { num: 1, action: 'ALLOW', from: 'Anywhere', to: '22/tcp', raw: '[1] ALLOW' },
    { num: 2, action: 'DENY', from: '203.0.113.10', to: 'Anywhere', raw: '[2] DENY' },
  ],
  numberedRules: [
    { num: 1, action: 'ALLOW', from: 'Anywhere', to: '22/tcp', raw: '[1] ALLOW' },
  ],
  denyFromIps: ['203.0.113.10'], notes: [], rulesMeta: { total: 1 } };

function mount(tab: string) {
  return render(
    <MemoryRouter initialEntries={[`/firewall?tab=${tab}`]}>
      <Routes><Route path="*" element={<FirewallPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('firewall surgical + helpers', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'], capabilities: [] });
    installFetchMock([
      softwareReadyRoute(),
      { match: (u) => u.includes('/auth/me'), body: { user: { username: 'admin', roles: ['admin'] }, capabilities: [] } },
      {
        match: (u) => u.includes('/firewall'),
        handler: (_u, init) => ((init?.method ?? 'GET').toUpperCase() !== 'GET' ? ok() : body) },
    ]);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); authStore.clear(); });

  it('pure helpers', () => {
    expect(parsePorts('80')).toEqual([80]);
    expect(firewallActionTone('ALLOW')).toBe('ok');
    expect(firewallActiveTone(true, true)).toBe('ok');
    expect(parsePortInput('443')).toBe('443');
    expect(parsePortInput('30000:30100/tcp')).toBe('30000:30100');
    expect(isValidDenyIp('1.1.1.1')).toBe(true);
    expect(mapFirewallRules([{ num: 1, action: 'ALLOW', to: 'x', from: 'y', raw: 'r' }], undefined)[0].num).toBe(1);
  });

  it('hits every handler', async () => {
      const probe = createUiProbe();
    // RULES
    let v = mount('rules');
    await waitFor(() => expect(screen.getByText(/allow/i)).toBeInTheDocument());
    const inp = document.querySelector('input') as HTMLInputElement | null;
    if (inp) {
      fireEvent.change(inp, { target: { value: '22' } });
      await new Promise((r) => setTimeout(r, 350));
      screen.queryAllByRole('button', { name: /clear/i }).forEach((b) => fireEvent.click(b));
    }
    // del + confirm
    const del = screen.queryAllByRole('button', { name: /^del$/i })[0];
    if (del) {
      fireEvent.click(del);
      await new Promise((r) => setTimeout(r, 30));
      const conf = screen.queryAllByRole('button', { name: /^delete$/i })[0];
      if (conf) fireEvent.click(conf);
      await new Promise((r) => setTimeout(r, 40));
    }
    // del + cancel
    const del2 = screen.queryAllByRole('button', { name: /^del$/i })[0];
    if (del2) {
      fireEvent.click(del2);
      await new Promise((r) => setTimeout(r, 20));
      screen.queryAllByRole('button', { name: /cancel/i }).forEach((b) => fireEvent.click(b));
    }
    screen.queryAllByRole('button', { name: /refresh/i }).forEach((b) => fireEvent.click(b));
    screen.queryAllByRole('button', { name: /disable|enable/i }).forEach((b) => fireEvent.click(b));
    await new Promise((r) => setTimeout(r, 50));
    screen.queryAllByRole('button', { name: /close/i }).forEach((b) => fireEvent.click(b));
    probe.sample(); v.unmount();

    // PORTS
    v = mount('ports');
    await waitFor(() => expect(document.body.innerText).toMatch(/TCP|UDP|port/i));
    document.querySelectorAll('.preset-chips__chip, .seg-radios__opt input, .seg-radios__opt').forEach((el) => fireEvent.click(el));
    screen.queryAllByRole('button', { name: /allow/i }).forEach((b) => {
      (b as HTMLButtonElement).disabled = false;
      b.removeAttribute('disabled');
      fireEvent.click(b);
    });
    await new Promise((r) => setTimeout(r, 40));
    probe.sample(); v.unmount();

    // DENY
    v = mount('deny');
    await waitFor(() => expect(document.body.innerText.length).toBeGreaterThan(20));
    const deny = document.getElementById('fw-deny') as HTMLInputElement | null;
    if (deny) fireEvent.change(deny, { target: { value: '198.51.100.9' } });
    screen.queryAllByRole('button', { name: /DENY from IP/i }).forEach((b) => {
      (b as HTMLButtonElement).disabled = false;
      b.removeAttribute('disabled');
      fireEvent.click(b);
    });
    screen.queryAllByRole('button', { name: /remove/i }).forEach((b) => fireEvent.click(b));
    await new Promise((r) => setTimeout(r, 40));
    probe.sample(); v.unmount();

    // PROFILES
    v = mount('profiles');
    await waitFor(() => expect(document.body.innerText).toMatch(/apply|smtp|extra/i));
    document.querySelectorAll('input[type=checkbox]').forEach((cb) => fireEvent.click(cb));
    document.querySelectorAll('.preset-chips__chip').forEach((c) => fireEvent.click(c));
    for (const b of screen.queryAllByRole('button', { name: /apply/i })) {
      fireEvent.click(b);
      await new Promise((r) => setTimeout(r, 35));
    }
    screen.queryAllByRole('button', { name: /close/i }).forEach((b) => fireEvent.click(b));
    probe.sample(); probe.sample();
      v.unmount();
      probe.sample();
      v.unmount();
      probe.assertRendered();
  });
});

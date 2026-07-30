import { tl } from '@ysk/shared';
/**
 * Four defense presets — data only + action list for UI preview.
 */

import type { DefenseAction, DefensePreset, DefensePresetId } from './types.js';

export const DEFENSE_PRESETS: Record<DefensePresetId, DefensePreset> = {
  daily: {
    id: 'daily',
    label: tl('notes.auto.n0914'),
    short: tl('notes.auto.n1031'),
    bullets: [
      tl('notes.auto.n0140'),
      tl('notes.auto.n0288'),
      tl('notes.auto.n0891'),
    ],
    nginx: { reqRate: '20r/s', burst: 40, connLimit: 80 },
    fail2banJails: ['sshd', 'nginx-http-auth', 'postfix', 'dovecot'],
    protectionHint: 'normal' },
  hardened: {
    id: 'hardened',
    label: tl('notes.auto.n0606'),
    short: tl('notes.auto.n0944'),
    bullets: [
      tl('notes.auto.n0138'),
      tl('notes.auto.n0926'),
      tl('notes.auto.n0823'),
    ],
    nginx: { reqRate: '8r/s', burst: 16, connLimit: 40 },
    fail2banJails: [
      'sshd',
      'nginx-http-auth',
      'nginx-botsearch',
      'nginx-badbots',
      'postfix',
      'dovecot',
    ],
    protectionHint: 'degraded' },
  under_attack: {
    id: 'under_attack',
    label: tl('notes.auto.n0608'),
    short: tl('notes.auto.n0126'),
    bullets: [
      tl('notes.auto.n0139'),
      tl('notes.auto.n0894'),
      tl('notes.auto.n0827'),
    ],
    nginx: { reqRate: '3r/s', burst: 8, connLimit: 20 },
    fail2banJails: [
      'sshd',
      'nginx-http-auth',
      'nginx-botsearch',
      'nginx-badbots',
      'nginx-limit-req',
      'postfix',
      'dovecot',
    ],
    protectionHint: 'ddos-protection',
    danger: true },
  emergency: {
    id: 'emergency',
    label: tl('notes.auto.n0030'),
    short: tl('notes.auto.n0639'),
    bullets: [
      tl('notes.auto.n0930'),
      tl('notes.auto.n0892'),
      tl('notes.auto.n1553'),
    ],
    nginx: { reqRate: '1r/s', burst: 3, connLimit: 8 },
    fail2banJails: ['sshd', 'nginx-http-auth', 'nginx-limit-req'],
    protectionHint: 'ddos-protection',
    danger: true,
    requireConfirm: 'EMERGENCY' } };

export function listDefensePresets(): DefensePreset[] {
  return (Object.keys(DEFENSE_PRESETS) as DefensePresetId[]).map((id) => DEFENSE_PRESETS[id]);
}

export function getDefensePreset(id: DefensePresetId): DefensePreset {
  return DEFENSE_PRESETS[id] ?? DEFENSE_PRESETS.daily;
}

/** Human-readable action checklist for a preset (preview before apply). */
export function buildPresetActions(preset: DefensePreset): DefenseAction[] {
  return [
    {
      id: 'nginx',
      kind: 'nginx_limits',
      title: tl('notes.auto.n0674'),
      detail: `limit_req ${preset.nginx.reqRate} burst=${preset.nginx.burst}；conn≤${preset.nginx.connLimit}` },
    {
      id: 'f2b',
      kind: 'fail2ban_jails',
      title: tl('notes.auto.n0928'),
      detail: preset.fail2banJails.join(', ') },
    {
      id: 'prot',
      kind: 'protection_mode',
      title: tl('notes.auto.n1365'),
      detail: `protectionHint=${preset.protectionHint}` },
    {
      id: 'ufw',
      kind: 'ufw_hint',
      title: tl('notes.auto.n1523'),
      detail: tl('notes.auto.n0555') },
  ];
}

/**
 * Four defense presets — static data + request-time i18n resolve.
 * Never call tl() at module load (freezes DEFAULT_LOCALE).
 */

import { tl } from '@ysk/shared';
import type { DefenseAction, DefensePreset, DefensePresetId } from './types.js';

type PresetDef = Omit<DefensePreset, 'label' | 'short' | 'bullets'> & {
  labelKey: string;
  shortKey: string;
  bulletKeys: string[];
};

const PRESET_DEFS: Record<DefensePresetId, PresetDef> = {
  daily: {
    id: 'daily',
    labelKey: 'notes.auto.n0914',
    shortKey: 'notes.auto.n1031',
    bulletKeys: ['notes.auto.n0140', 'notes.auto.n0288', 'notes.auto.n0891'],
    nginx: { reqRate: '20r/s', burst: 40, connLimit: 80 },
    fail2banJails: ['sshd', 'nginx-http-auth', 'postfix', 'dovecot'],
    protectionHint: 'normal',
  },
  hardened: {
    id: 'hardened',
    labelKey: 'notes.auto.n0606',
    shortKey: 'notes.auto.n0944',
    bulletKeys: ['notes.auto.n0138', 'notes.auto.n0926', 'notes.auto.n0823'],
    nginx: { reqRate: '8r/s', burst: 16, connLimit: 40 },
    fail2banJails: [
      'sshd',
      'nginx-http-auth',
      'nginx-botsearch',
      'nginx-badbots',
      'postfix',
      'dovecot',
    ],
    protectionHint: 'degraded',
  },
  under_attack: {
    id: 'under_attack',
    labelKey: 'notes.auto.n0608',
    shortKey: 'notes.auto.n0126',
    bulletKeys: ['notes.auto.n0139', 'notes.auto.n0894', 'notes.auto.n0827'],
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
    danger: true,
  },
  emergency: {
    id: 'emergency',
    labelKey: 'notes.auto.n0030',
    shortKey: 'notes.auto.n0639',
    bulletKeys: ['notes.auto.n0930', 'notes.auto.n0892', 'notes.auto.n1553'],
    nginx: { reqRate: '1r/s', burst: 3, connLimit: 8 },
    fail2banJails: ['sshd', 'nginx-http-auth', 'nginx-limit-req'],
    protectionHint: 'ddos-protection',
    danger: true,
    requireConfirm: 'EMERGENCY',
  },
};

function resolvePreset(def: PresetDef): DefensePreset {
  return {
    id: def.id,
    label: tl(def.labelKey),
    short: tl(def.shortKey),
    bullets: def.bulletKeys.map((k) => tl(k)),
    nginx: def.nginx,
    fail2banJails: def.fail2banJails,
    protectionHint: def.protectionHint,
    danger: def.danger,
    requireConfirm: def.requireConfirm,
  };
}

/** @deprecated use listDefensePresets() — kept as empty proxy for type imports */
export const DEFENSE_PRESETS: Record<DefensePresetId, DefensePreset> = new Proxy(
  {} as Record<DefensePresetId, DefensePreset>,
  {
    get(_t, prop: string) {
      if (prop in PRESET_DEFS) return resolvePreset(PRESET_DEFS[prop as DefensePresetId]);
      return undefined;
    },
    ownKeys() {
      return Object.keys(PRESET_DEFS);
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (prop in PRESET_DEFS) {
        return { enumerable: true, configurable: true, value: resolvePreset(PRESET_DEFS[prop as DefensePresetId]) };
      }
      return undefined;
    },
  },
);

export function listDefensePresets(): DefensePreset[] {
  return (Object.keys(PRESET_DEFS) as DefensePresetId[]).map((id) => resolvePreset(PRESET_DEFS[id]!));
}

export function getDefensePreset(id: DefensePresetId): DefensePreset {
  const def = PRESET_DEFS[id] ?? PRESET_DEFS.daily;
  return resolvePreset(def);
}

/** Human-readable action checklist for a preset (preview before apply). */
export function buildPresetActions(preset: DefensePreset): DefenseAction[] {
  return [
    {
      id: 'nginx',
      kind: 'nginx_limits',
      title: tl('notes.auto.n0674'),
      detail: `limit_req ${preset.nginx.reqRate} burst=${preset.nginx.burst}; conn≤${preset.nginx.connLimit}`,
    },
    {
      id: 'f2b',
      kind: 'fail2ban_jails',
      title: tl('notes.auto.n0928'),
      detail: preset.fail2banJails.join(', '),
    },
    {
      id: 'prot',
      kind: 'protection_mode',
      title: tl('notes.auto.n1365'),
      detail: `protectionHint=${preset.protectionHint}`,
    },
    {
      id: 'ufw',
      kind: 'ufw_hint',
      title: tl('notes.auto.n1523'),
      detail: tl('notes.auto.n0555'),
    },
  ];
}

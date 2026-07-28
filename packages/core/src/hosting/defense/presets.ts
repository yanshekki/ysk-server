/**
 * Four defense presets — data only + action list for UI preview.
 */

import type { DefenseAction, DefensePreset, DefensePresetId } from './types.js';

export const DEFENSE_PRESETS: Record<DefensePresetId, DefensePreset> = {
  daily: {
    id: 'daily',
    label: '日常',
    short: '正常營運預設',
    bullets: [
      'Nginx 溫和限速（約 20 req/s）',
      'fail2ban：sshd、nginx-http-auth 等標準 jail',
      '控制面維持正常模式',
    ],
    nginx: { reqRate: '20r/s', burst: 40, connLimit: 80 },
    fail2banJails: ['sshd', 'nginx-http-auth', 'postfix', 'dovecot'],
    protectionHint: 'normal',
  },
  hardened: {
    id: 'hardened',
    label: '加固',
    short: '有掃描／暴力跡象時',
    bullets: [
      'Nginx 收緊限速（約 8 req/s）',
      '更多 fail2ban jail、更快封禁',
      '建議檢查 SSH 與非必要埠',
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
    protectionHint: 'degraded',
  },
  under_attack: {
    id: 'under_attack',
    label: '受攻擊',
    short: 'L7 爆量／異常流量',
    bullets: [
      'Nginx 極嚴限速（約 3 req/s）',
      '控制面進入 ddos-protection 提示',
      '建議開啟 CDN Under Attack 模式',
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
    danger: true,
  },
  emergency: {
    id: 'emergency',
    label: '緊急',
    short: '失控時最後手段',
    bullets: [
      '最嚴 Nginx 限連（約 1 req/s）',
      '控制面緊急降級（local ops）',
      '需確認字串 EMERGENCY；防鎖死自己',
    ],
    nginx: { reqRate: '1r/s', burst: 3, connLimit: 8 },
    fail2banJails: ['sshd', 'nginx-http-auth', 'nginx-limit-req'],
    protectionHint: 'ddos-protection',
    danger: true,
    requireConfirm: 'EMERGENCY',
  },
};

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
      title: '寫入 Nginx 限速 drop-in',
      detail: `limit_req ${preset.nginx.reqRate} burst=${preset.nginx.burst}；conn≤${preset.nginx.connLimit}`,
    },
    {
      id: 'f2b',
      kind: 'fail2ban_jails',
      title: '更新 fail2ban jail 清單（管理檔）',
      detail: preset.fail2banJails.join(', '),
    },
    {
      id: 'prot',
      kind: 'protection_mode',
      title: '記錄防護模式提示',
      detail: `protectionHint=${preset.protectionHint}`,
    },
    {
      id: 'ufw',
      kind: 'ufw_hint',
      title: '防火牆建議（不自動改 UFW 除非套用系統）',
      detail: '保持 22/80/443；受攻擊時可手動關非必要埠',
    },
  ];
}

/**
 * Email warm-up (reputation) guidance — Spec §5.4 D.
 * Pure structured tips; no fake "warmed" state without operator action.
 */

import { tl } from 'ysk-server-shared';

export interface WarmupPhase {
  dayFrom: number;
  dayTo: number;
  maxMessagesPerDay: number;
  guidance: string[];
}

export interface WarmupPlan {
  domain: string;
  serverIp: string;
  phases: WarmupPhase[];
  checklist: string[];
  notes: string[];
}

/**
 * Build a conservative warm-up schedule for a new mail IP/domain.
 */
export function planEmailWarmup(input: {
  domain: string;
  serverIp: string;
  isNewIp?: boolean;
}): WarmupPlan {
  const domain = input.domain.trim().toLowerCase();
  const phases: WarmupPhase[] = [
    {
      dayFrom: 1,
      dayTo: 3,
      maxMessagesPerDay: 20,
      guidance: [
        tl('email.warmup.p1g1'),
        tl('email.warmup.p1g2'),
        tl('email.warmup.p1g3'),
      ],
    },
    {
      dayFrom: 4,
      dayTo: 7,
      maxMessagesPerDay: 50,
      guidance: [
        tl('email.warmup.p2g1'),
        tl('email.warmup.p2g2'),
        tl('email.warmup.p2g3'),
      ],
    },
    {
      dayFrom: 8,
      dayTo: 14,
      maxMessagesPerDay: 150,
      guidance: [tl('email.warmup.p3g1'), tl('email.warmup.p3g2')],
    },
    {
      dayFrom: 15,
      dayTo: 30,
      maxMessagesPerDay: 500,
      guidance: [tl('email.warmup.p4g1'), tl('email.warmup.p4g2')],
    },
  ];
  const checklist = [
    tl('email.warmup.c1'),
    tl('email.warmup.c2'),
    tl('email.warmup.c3'),
    tl('email.warmup.c4'),
    tl('email.warmup.c5'),
    tl('email.warmup.c6'),
  ];
  const notes = [
    input.isNewIp !== false ? tl('email.warmup.noteNewIp') : tl('email.warmup.noteOldIp'),
    tl('email.warmup.noteProcess'),
  ];
  return { domain, serverIp: input.serverIp, phases, checklist, notes };
}

/**
 * Email warm-up (reputation) guidance — Spec §5.4 D.
 * Pure structured tips; no fake "warmed" state without operator action.
 */

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
        'Send only transactional / known-good recipients',
        'Monitor bounces; keep complaint rate near zero',
        'Ensure SPF/DKIM/DMARC/PTR are live before volume',
      ],
    },
    {
      dayFrom: 4,
      dayTo: 7,
      maxMessagesPerDay: 50,
      guidance: [
        'Expand slowly to engaged contacts only',
        'Check DNSBL daily; pause if listed',
        'Prefer 587 submission over bulk on port 25 if restricted',
      ],
    },
    {
      dayFrom: 8,
      dayTo: 14,
      maxMessagesPerDay: 150,
      guidance: [
        'Double volume only if metrics stay clean',
        'Segment lists; remove hard bounces immediately',
      ],
    },
    {
      dayFrom: 15,
      dayTo: 30,
      maxMessagesPerDay: 500,
      guidance: [
        'Approach normal volume if no blocks',
        'Keep DMARC rua monitored',
      ],
    },
  ];
  const checklist = [
    'PTR matches HELO/EHLO (mail hostname)',
    'SPF + DKIM + DMARC published and aligned',
    'DNSBL clean on Spamhaus / SpamCop / Barracuda',
    'Outbound port 25 open or relay configured',
    'No purchased “bulk email” IP ranges',
    'Domain age / history considered (new domains = slower ramp)',
  ];
  const notes = [
    input.isNewIp !== false
      ? 'Treat this IP as new — start at phase day 1–3 limits'
      : 'Existing IP still benefits from gradual ramp after config changes',
    'Warm-up is operator process; YSK tracks tips + DNSBL, not marketing ESP volume',
  ];
  return { domain, serverIp: input.serverIp, phases, checklist, notes };
}

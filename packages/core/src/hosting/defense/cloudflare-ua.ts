/**
 * Cloudflare Under Attack / security level API (Phase B).
 * Uses CF_API_TOKEN — fail-closed when missing or API fails.
 */

export type CfSecurityLevel =
  | 'off'
  | 'essentially_off'
  | 'low'
  | 'medium'
  | 'high'
  | 'under_attack';

export type CfUnderAttackResult = {
  ok: boolean;
  dryRun: boolean;
  requiresToken: boolean;
  zone?: string;
  zoneId?: string;
  previousLevel?: string;
  level?: CfSecurityLevel;
  notes: string[];
  errors: string[];
};

type CfFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: CfFetch = async (url, init) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, json: () => res.json() as Promise<unknown> };
};

function tokenFrom(explicit?: string): string | undefined {
  return explicit?.trim() || process.env.CF_API_TOKEN?.trim() || undefined;
}

async function resolveZoneId(
  zoneName: string,
  token: string,
  fetchImpl: CfFetch,
): Promise<{ zoneId?: string; error?: string }> {
  const url = `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = (await res.json()) as {
    success?: boolean;
    result?: Array<{ id: string; name: string }>;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok || !body.success || !body.result?.[0]?.id) {
    return {
      error:
        body.errors?.[0]?.message ||
        `無法解析 zone ${zoneName}（HTTP ${res.status}）`,
    };
  }
  return { zoneId: body.result[0].id };
}

/**
 * Set Cloudflare zone security_level (e.g. under_attack).
 */
export async function setCloudflareSecurityLevel(input: {
  zone: string;
  level: CfSecurityLevel;
  token?: string;
  dryRun?: boolean;
  fetchImpl?: CfFetch;
}): Promise<CfUnderAttackResult> {
  const notes: string[] = [];
  const zone = input.zone.trim().toLowerCase();
  if (!zone) {
    return {
      ok: false,
      dryRun: Boolean(input.dryRun),
      requiresToken: true,
      notes: [],
      errors: ['需要 zone 域名'],
    };
  }
  const token = tokenFrom(input.token);
  if (!token) {
    return {
      ok: false,
      dryRun: true,
      requiresToken: true,
      zone,
      level: input.level,
      notes: [
        '未設定 CF_API_TOKEN — 無法呼叫 Cloudflare API',
        `計劃：將 ${zone} security_level → ${input.level}`,
      ],
      errors: ['missing CF_API_TOKEN'],
    };
  }
  if (input.dryRun) {
    return {
      ok: true,
      dryRun: true,
      requiresToken: false,
      zone,
      level: input.level,
      notes: [`模擬：${zone} → security_level=${input.level}`],
      errors: [],
    };
  }

  const fetchImpl = input.fetchImpl ?? defaultFetch;
  try {
    const z = await resolveZoneId(zone, token, fetchImpl);
    if (!z.zoneId) {
      return {
        ok: false,
        dryRun: false,
        requiresToken: false,
        zone,
        notes,
        errors: [z.error || 'zone 解析失敗'],
      };
    }
    // read current
    let previousLevel: string | undefined;
    try {
      const cur = await fetchImpl(
        `https://api.cloudflare.com/client/v4/zones/${z.zoneId}/settings/security_level`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const cj = (await cur.json()) as { result?: { value?: string } };
      previousLevel = cj.result?.value;
    } catch {
      /* ignore */
    }

    const res = await fetchImpl(
      `https://api.cloudflare.com/client/v4/zones/${z.zoneId}/settings/security_level`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: input.level }),
      },
    );
    const body = (await res.json()) as {
      success?: boolean;
      errors?: Array<{ message?: string }>;
      result?: { value?: string };
    };
    if (!res.ok || !body.success) {
      const msg = body.errors?.[0]?.message || `HTTP ${res.status}`;
      return {
        ok: false,
        dryRun: false,
        requiresToken: false,
        zone,
        zoneId: z.zoneId,
        previousLevel,
        notes,
        errors: [msg],
      };
    }
    notes.push(
      `Cloudflare ${zone}: security_level ${previousLevel ?? '?'} → ${body.result?.value ?? input.level}`,
    );
    return {
      ok: true,
      dryRun: false,
      requiresToken: false,
      zone,
      zoneId: z.zoneId,
      previousLevel,
      level: (body.result?.value as CfSecurityLevel) || input.level,
      notes,
      errors: [],
    };
  } catch (e) {
    return {
      ok: false,
      dryRun: false,
      requiresToken: false,
      zone,
      notes,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
}

/** Enable Under Attack mode for one or more zones. */
export async function enableCloudflareUnderAttack(input: {
  zones: string[];
  token?: string;
  dryRun?: boolean;
}): Promise<{
  ok: boolean;
  results: CfUnderAttackResult[];
  notes: string[];
}> {
  const results: CfUnderAttackResult[] = [];
  for (const zone of input.zones.slice(0, 20)) {
    results.push(
      await setCloudflareSecurityLevel({
        zone,
        level: 'under_attack',
        token: input.token,
        dryRun: input.dryRun,
      }),
    );
  }
  return {
    ok: results.some((r) => r.ok),
    results,
    notes: results.flatMap((r) => [...r.notes, ...r.errors.map((e) => `err: ${e}`)]).slice(0, 20),
  };
}

export async function disableCloudflareUnderAttack(input: {
  zones: string[];
  /** restore level, default high */
  level?: CfSecurityLevel;
  token?: string;
  dryRun?: boolean;
}): Promise<{ ok: boolean; results: CfUnderAttackResult[]; notes: string[] }> {
  const level = input.level ?? 'high';
  const results: CfUnderAttackResult[] = [];
  for (const zone of input.zones.slice(0, 20)) {
    results.push(
      await setCloudflareSecurityLevel({
        zone,
        level,
        token: input.token,
        dryRun: input.dryRun,
      }),
    );
  }
  return {
    ok: results.some((r) => r.ok),
    results,
    notes: results.flatMap((r) => r.notes).slice(0, 20),
  };
}

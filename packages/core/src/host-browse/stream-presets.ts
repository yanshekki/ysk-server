/**
 * Host-browse live stream quality presets.
 */

export type StreamPresetId = 'smooth' | 'balanced' | 'sharp' | 'custom';

export type StreamOptions = {
  preset: StreamPresetId;
  /** JPEG quality 40–100 */
  quality: number;
  /** Multiply viewport before screencast max size */
  scale: number;
  everyNthFrame: number;
  /** Hard cap on screencast width */
  maxWidthCap: number;
  maxHeightCap: number;
};

export const STREAM_PRESETS: Record<Exclude<StreamPresetId, 'custom'>, Omit<StreamOptions, 'preset'>> = {
  smooth: {
    quality: 55,
    scale: 0.75,
    everyNthFrame: 2,
    maxWidthCap: 1600,
    maxHeightCap: 1000,
  },
  balanced: {
    quality: 80,
    scale: 1,
    everyNthFrame: 1,
    maxWidthCap: 1920,
    maxHeightCap: 1200,
  },
  sharp: {
    quality: 92,
    scale: 1.25,
    everyNthFrame: 1,
    maxWidthCap: 1920,
    maxHeightCap: 1200,
  },
};

export function resolveStreamOptions(
  input?: Partial<StreamOptions> & { preset?: StreamPresetId },
): StreamOptions {
  const rawPreset = input?.preset ?? 'balanced';
  const named: Exclude<StreamPresetId, 'custom'> =
    rawPreset === 'smooth' || rawPreset === 'sharp' || rawPreset === 'balanced'
      ? rawPreset
      : 'balanced';
  const base = STREAM_PRESETS[named];
  const quality = clamp(input?.quality ?? base.quality, 40, 100);
  const scale = clamp(input?.scale ?? base.scale, 0.5, 1.5);
  const everyNthFrame = Math.max(
    1,
    Math.min(5, Math.floor(input?.everyNthFrame ?? base.everyNthFrame)),
  );
  const maxWidthCap = clamp(input?.maxWidthCap ?? base.maxWidthCap, 640, 2560);
  const maxHeightCap = clamp(input?.maxHeightCap ?? base.maxHeightCap, 480, 1600);
  const isCustom =
    rawPreset === 'custom' ||
    (input?.quality != null && input.quality !== base.quality) ||
    (input?.scale != null && input.scale !== base.scale);
  return {
    preset: isCustom && rawPreset === 'custom' ? 'custom' : named,
    quality,
    scale,
    everyNthFrame,
    maxWidthCap,
    maxHeightCap,
  };
}

export function clampViewport(w: number, h: number): { w: number; h: number } {
  return {
    w: Math.floor(clamp(w, 320, 1920)),
    h: Math.floor(clamp(h, 240, 1200)),
  };
}

export function screencastSize(
  viewport: { w: number; h: number },
  opts: StreamOptions,
): { maxWidth: number; maxHeight: number } {
  const maxWidth = Math.min(
    opts.maxWidthCap,
    Math.max(320, Math.floor(viewport.w * opts.scale)),
  );
  const maxHeight = Math.min(
    opts.maxHeightCap,
    Math.max(240, Math.floor(viewport.h * opts.scale)),
  );
  return { maxWidth, maxHeight };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Heuristic: page title / url looks like bot / captcha interstitial */
export function detectBotChallenge(title: string, url: string): boolean {
  const t = `${title} ${url}`.toLowerCase();
  const needles = [
    'just a moment',
    'attention required',
    'cf-browser-verification',
    'checking your browser',
    'captcha',
    'cloudflare',
    'access denied',
    '請完成',
    '安全驗證',
    '人機驗證',
    'verify you are human',
  ];
  return needles.some((n) => t.includes(n));
}

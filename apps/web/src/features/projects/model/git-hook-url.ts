/** Absolute webhook URL the operator pastes into GitHub / Gitea / GitLab. */
export function projectGitHookAbsoluteUrl(
  path: string | undefined,
  origin = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  const p = String(path ?? '').trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  const base = String(origin ?? '').replace(/\/$/, '');
  const rel = p.startsWith('/') ? p : `/${p}`;
  return base ? `${base}${rel}` : rel;
}

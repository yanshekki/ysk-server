/**
 * Resolve host public IPv4 at container start. Fail-open: empty PUB is OK.
 * Only ifconfig.me / ident.me — no custom STUN service.
 */
export const RESOLVE_PUBLIC_IP_SH = `PUB=""
PUB=$(wget -qO- --timeout=5 https://ifconfig.me 2>/dev/null || true)
if [ -z "$PUB" ]; then PUB=$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true); fi
if [ -z "$PUB" ]; then PUB=$(wget -qO- --timeout=5 https://ident.me 2>/dev/null || true); fi
if [ -z "$PUB" ]; then PUB=$(curl -fsS --max-time 5 https://ident.me 2>/dev/null || true); fi
`;

/**
 * Docker Compose interpolates $VAR in the file before the container runs.
 * Double every `$` so the shell inside the container still sees `$VAR` / `$(...)`.
 */
export function escapeComposeDollars(script: string): string {
  return script.replace(/\$/g, '$$$$');
}

/** Indent a container shell script for a compose `command: |` block. */
export function composeCommandScript(script: string, indent = '        '): string {
  return escapeComposeDollars(script)
    .split('\n')
    .map((line) => (line.length ? `${indent}${line}` : indent.trimEnd()))
    .join('\n')
    .replace(/\n+$/, '');
}

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

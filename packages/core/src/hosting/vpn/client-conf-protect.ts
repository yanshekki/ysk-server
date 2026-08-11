/**
 * Outbound VPN client conf hardening for ysk-server hosts.
 *
 * Full-tunnel clients (AllowedIPs = 0.0.0.0/0) replace the default route.
 * Replies to the panel / SSH / public services then leave via the tunnel →
 * clients cannot reach the panel. Fix: source-based policy routing so
 * traffic FROM local interface IPs always uses the main table.
 */

const MARK_BEGIN = '# YSK-CLIENT-HOST-PROTECT-BEGIN';
const MARK_END = '# YSK-CLIENT-HOST-PROTECT-END';

/** Detect full-tunnel AllowedIPs (IPv4 and/or IPv6 default). */
export function isFullTunnelAllowedIps(text: string): boolean {
  // Match AllowedIPs lines containing 0.0.0.0/0 or ::/0
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!/^\s*AllowedIPs\s*=/i.test(line)) continue;
    const v = line.split('=')[1] ?? '';
    if (/\b0\.0\.0\.0\/0\b/.test(v) || /(^|[\s,])::\/0([\s,]|$)/.test(v)) {
      return true;
    }
  }
  return false;
}

/** Extract first IPv4 Endpoint host (hostname or IP). */
export function extractWgEndpointHost(conf: string): string | null {
  for (const line of conf.split(/\r?\n/)) {
    const m = line.match(/^\s*Endpoint\s*=\s*([^:\s]+)/i);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/**
 * Shell body written to /usr/local/lib/ysk-server/vpn-client-protect.sh
 * Usage: vpn-client-protect.sh up|down [iface]
 */
export function buildVpnClientProtectScript(): string {
  return `#!/bin/bash
# YSK: keep panel/SSH reachable when outbound VPN is full-tunnel
set +e
ACTION="\${1:-up}"
TAG="ysk-vpn-client-src"
# priority band reserved for YSK client protect
PRIO=52

list_local_ips() {
  ip -4 -o addr show up 2>/dev/null | awk '
    $2 ~ /^(lo|wg|tun|tap|docker|veth|br-)/ { next }
    $2 ~ /^wg-/ { next }
    {
      split($4, a, "/");
      if (a[1] != "" && a[1] != "127.0.0.1") print a[1];
    }'
}

add_rules() {
  while read -r ip; do
    [ -z "\$ip" ] && continue
    # idempotent: delete then add
    ip rule del from "\$ip" lookup main priority \$PRIO 2>/dev/null
    ip rule add from "\$ip" lookup main priority \$PRIO 2>/dev/null || true
  done < <(list_local_ips)
  # also protect link-local return for default WAN iface
  WAN=\$(ip route 2>/dev/null | awk '/default/{print \$5; exit}')
  if [ -n "\$WAN" ]; then
    WIP=\$(ip -4 -o addr show dev "\$WAN" 2>/dev/null | awk '{split(\$4,a,"/"); print a[1]; exit}')
    if [ -n "\$WIP" ]; then
      ip rule del from "\$WIP" lookup main priority \$PRIO 2>/dev/null
      ip rule add from "\$WIP" lookup main priority \$PRIO 2>/dev/null || true
    fi
  fi
  echo "YSK-CLIENT-PROTECT: source rules applied (prio=\$PRIO)"
}

del_rules() {
  # remove all our priority rules
  ip rule show 2>/dev/null | awk -v p=\$PRIO '\$1==p":"{print}' | while read -r line; do
    # e.g. "52:    from 1.2.3.4 lookup main"
    fr=\$(echo "\$line" | awk '{for(i=1;i<=NF;i++) if(\$i=="from"){print \$(i+1); exit}}')
    [ -n "\$fr" ] && ip rule del from "\$fr" lookup main priority \$PRIO 2>/dev/null || true
  done
  echo "YSK-CLIENT-PROTECT: source rules cleared"
}

case "\$ACTION" in
  up) add_rules ;;
  down) del_rules ;;
  *) echo "usage: \$0 up|down"; exit 2 ;;
esac
exit 0
`;
}

/**
 * Inject PostUp/PreDown host protection into a WireGuard client conf.
 * Idempotent (strips previous YSK protect block first).
 * Does not remove full tunnel — keeps user's intent but fixes panel access.
 */
export function injectWgClientHostProtection(conf: string): {
  conf: string;
  fullTunnel: boolean;
  modified: boolean;
} {
  const fullTunnel = isFullTunnelAllowedIps(conf);
  let body = conf.replace(/\r\n/g, '\n');
  // strip previous block
  const re = new RegExp(
    `\\n?${MARK_BEGIN}[\\s\\S]*?${MARK_END}\\n?`,
    'g',
  );
  body = body.replace(re, '\n');

  if (!fullTunnel) {
    return { conf: body.endsWith('\n') ? body : body + '\n', fullTunnel: false, modified: false };
  }

  const block = [
    MARK_BEGIN,
    '# Keep ysk-server panel/SSH reachable (source-route via main table)',
    'PostUp = /usr/local/lib/ysk-server/vpn-client-protect.sh up %i',
    'PreDown = /usr/local/lib/ysk-server/vpn-client-protect.sh down %i',
    MARK_END,
    '',
  ].join('\n');

  // Insert after [Interface] section header (first occurrence)
  if (/\[Interface\]/i.test(body)) {
    body = body.replace(/(\[Interface\][^\n]*\n)/i, `$1${block}`);
  } else {
    body = block + body;
  }

  // Soften DNS takeover on control-plane hosts: comment DNS= so host resolv stays usable
  // (full-tunnel DNS to remote often breaks local panel hostname resolution)
  body = body
    .split('\n')
    .map((line) => {
      if (/^\s*DNS\s*=/i.test(line) && !line.trim().startsWith('#')) {
        return `# YSK: DNS disabled on control-plane host (was: ${line.trim()})\n#${line}`;
      }
      return line;
    })
    .join('\n');

  if (!body.endsWith('\n')) body += '\n';
  return { conf: body, fullTunnel: true, modified: true };
}

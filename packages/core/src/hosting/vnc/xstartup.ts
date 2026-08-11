/**
 * Generate ~/.vnc/xstartup for desktop profiles.
 * Only two product choices: XFCE desktop or terminal-only.
 */

import type { VncDesktopProfile } from './types.js';
import { normalizeVncDesktopProfile } from './types.js';

const HEADER = `#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
[ -r "$HOME/.Xresources" ] && xrdb "$HOME/.Xresources" 2>/dev/null || true
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:\${PATH:-}"
`;

const TERMINAL_SHELL = `
# YSK profile "terminal" — terminal only (no full desktop)
if command -v xsetroot >/dev/null 2>&1; then
  xsetroot -solid '#0f172a'
fi
if command -v xfce4-terminal >/dev/null 2>&1; then
  exec xfce4-terminal --maximize -T 'YSK VNC · terminal'
fi
if command -v gnome-terminal >/dev/null 2>&1; then
  exec gnome-terminal --title='YSK VNC · terminal'
fi
if command -v x-terminal-emulator >/dev/null 2>&1; then
  exec x-terminal-emulator -T 'YSK VNC · terminal'
fi
if command -v xterm >/dev/null 2>&1; then
  exec xterm -geometry 120x40+40+40 -ls -bg '#0f172a' -fg '#e2e8f0' -title 'YSK VNC · terminal'
fi
# Keep X alive if no terminal binary is installed
exec /bin/sh -c 'while true; do sleep 86400; done'
`;

export function buildXstartup(profile: VncDesktopProfile | string): string {
  const p = normalizeVncDesktopProfile(profile);
  if (p === 'xfce') {
    return (
      HEADER +
      `export XKL_XMODMAP_DISABLE=1
# YSK profile "xfce": full desktop
if command -v startxfce4 >/dev/null 2>&1; then
  exec startxfce4
fi
if command -v xfce4-session >/dev/null 2>&1; then
  exec xfce4-session
fi
# XFCE missing — terminal fallback
` +
      TERMINAL_SHELL
    );
  }
  return HEADER + `# YSK profile "terminal"\n` + TERMINAL_SHELL;
}

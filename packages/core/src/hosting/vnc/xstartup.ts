/**
 * Generate ~/.vnc/xstartup for desktop profiles.
 */

import type { VncDesktopProfile } from './types.js';

/** Shared fallback when preferred DE is missing — never require xterm alone. */
const SESSION_FALLBACK = `
# Prefer real sessions; keep X alive without xterm (often not installed)
if command -v startxfce4 >/dev/null 2>&1; then
  exec startxfce4
fi
if command -v xfce4-session >/dev/null 2>&1; then
  exec xfce4-session
fi
if command -v openbox-session >/dev/null 2>&1; then
  exec openbox-session
fi
if command -v twm >/dev/null 2>&1; then
  twm &
fi
if command -v x-terminal-emulator >/dev/null 2>&1; then
  exec x-terminal-emulator
fi
if command -v xfce4-terminal >/dev/null 2>&1; then
  exec xfce4-terminal
fi
if command -v xterm >/dev/null 2>&1; then
  exec xterm -geometry 100x30+10+10 -ls
fi
# Last resort: keep display up so noVNC/VNC client can connect
exec /bin/sh -c 'while true; do sleep 86400; done'
`;

export function buildXstartup(profile: VncDesktopProfile): string {
  const common = `#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
[ -r "$HOME/.Xresources" ] && xrdb "$HOME/.Xresources" 2>/dev/null || true
`;
  if (profile === 'xfce') {
    return (
      common +
      `export XKL_XMODMAP_DISABLE=1
if command -v startxfce4 >/dev/null 2>&1; then
  exec startxfce4
fi
if command -v xfce4-session >/dev/null 2>&1; then
  exec xfce4-session
fi
` +
      SESSION_FALLBACK
    );
  }
  if (profile === 'minimal') {
    return (
      common +
      `if command -v openbox-session >/dev/null 2>&1; then
  exec openbox-session
fi
if command -v twm >/dev/null 2>&1; then
  twm &
fi
` +
      SESSION_FALLBACK
    );
  }
  // none — still provide working fallbacks so "start" is not a hard fail
  return common + `# YSK: desktop profile "none" — customise below\n` + SESSION_FALLBACK;
}

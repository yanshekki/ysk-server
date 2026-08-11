/**
 * Generate ~/.vnc/xstartup for desktop profiles.
 * Profiles must look different when connected — never funnel everything into XFCE.
 */

import type { VncDesktopProfile } from './types.js';

const HEADER = `#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
[ -r "$HOME/.Xresources" ] && xrdb "$HOME/.Xresources" 2>/dev/null || true
`;

/** Terminal-only / keep-alive — no full desktop environment. */
const LIGHT_SHELL = `
# Light session only (no XFCE / full DE)
if command -v openbox-session >/dev/null 2>&1; then
  openbox-session &
elif command -v twm >/dev/null 2>&1; then
  twm &
elif command -v fluxbox >/dev/null 2>&1; then
  fluxbox &
fi
if command -v xfce4-terminal >/dev/null 2>&1; then
  exec xfce4-terminal --maximize
fi
if command -v x-terminal-emulator >/dev/null 2>&1; then
  exec x-terminal-emulator
fi
if command -v xterm >/dev/null 2>&1; then
  exec xterm -geometry 120x40+20+20 -ls -title 'YSK VNC minimal'
fi
# Keep X alive so VNC/noVNC stays connected
exec /bin/sh -c 'while true; do sleep 86400; done'
`;

/** Custom / none: blank canvas — do not auto-start XFCE. */
const NONE_SHELL = `
# YSK profile "none": customise this file. No desktop is auto-started.
# Add your own session command below (panel DE, WM, or a single app).
if command -v xterm >/dev/null 2>&1; then
  exec xterm -geometry 100x30+10+10 -ls -title 'YSK VNC custom (edit ~/.vnc/xstartup)'
fi
if command -v xfce4-terminal >/dev/null 2>&1; then
  exec xfce4-terminal -T 'YSK VNC custom (edit ~/.vnc/xstartup)'
fi
if command -v x-terminal-emulator >/dev/null 2>&1; then
  exec x-terminal-emulator
fi
exec /bin/sh -c 'while true; do sleep 86400; done'
`;

export function buildXstartup(profile: VncDesktopProfile): string {
  if (profile === 'xfce') {
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
# XFCE missing — light fallback (still not pretending we have XFCE panels)
` +
      LIGHT_SHELL
    );
  }
  if (profile === 'minimal') {
    return HEADER + `# YSK profile "minimal": lightweight WM + terminal (full DE not used)\n` + LIGHT_SHELL;
  }
  // none — custom; never auto XFCE
  return HEADER + NONE_SHELL;
}

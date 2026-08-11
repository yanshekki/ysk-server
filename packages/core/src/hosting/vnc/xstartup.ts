/**
 * Generate ~/.vnc/xstartup for desktop profiles.
 * Profiles must look different when connected — never funnel everything into XFCE
 * or the same plain terminal.
 */

import type { VncDesktopProfile } from './types.js';

const HEADER = `#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
[ -r "$HOME/.Xresources" ] && xrdb "$HOME/.Xresources" 2>/dev/null || true
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:\${PATH:-}"
`;

/**
 * Minimal: light WM when available + distinct solid root colour + terminal.
 * Never starts XFCE.
 */
const MINIMAL_SHELL = `
# YSK profile "minimal" — lightweight, not a full DE
if command -v xsetroot >/dev/null 2>&1; then
  xsetroot -solid '#0f766e'
fi
WM_STARTED=0
if command -v openbox-session >/dev/null 2>&1; then
  openbox-session &
  WM_STARTED=1
elif command -v openbox >/dev/null 2>&1; then
  openbox &
  WM_STARTED=1
elif command -v fluxbox >/dev/null 2>&1; then
  fluxbox &
  WM_STARTED=1
elif command -v twm >/dev/null 2>&1; then
  twm &
  WM_STARTED=1
elif command -v icewm-session >/dev/null 2>&1; then
  icewm-session &
  WM_STARTED=1
elif command -v icewm >/dev/null 2>&1; then
  icewm &
  WM_STARTED=1
fi
# Distinctive terminal title so operators can tell the profile apart
if command -v xfce4-terminal >/dev/null 2>&1; then
  exec xfce4-terminal --maximize -T 'YSK VNC · minimal'
fi
if command -v gnome-terminal >/dev/null 2>&1; then
  exec gnome-terminal --title='YSK VNC · minimal'
fi
if command -v x-terminal-emulator >/dev/null 2>&1; then
  exec x-terminal-emulator -T 'YSK VNC · minimal'
fi
if command -v xterm >/dev/null 2>&1; then
  exec xterm -geometry 120x40+40+40 -ls -bg '#042f2e' -fg '#ccfbf1' -title 'YSK VNC · minimal'
fi
# No terminal binary: keep teal root so it is still not a blank "none" screen
exec /bin/sh -c 'while true; do sleep 86400; done'
`;

/**
 * None / custom: empty dark canvas only — no WM, no terminal.
 * User replaces ~/.vnc/xstartup for a custom session.
 */
const NONE_SHELL = `
# YSK profile "none" — empty session (customise ~/.vnc/xstartup)
# Intentionally does NOT start a terminal or desktop (contrast with "minimal").
if command -v xsetroot >/dev/null 2>&1; then
  xsetroot -solid '#111827'
fi
if command -v xmessage >/dev/null 2>&1; then
  xmessage -center -buttons '' -timeout 12 'YSK VNC · custom (none)
Edit ~/.vnc/xstartup for your own session.
This profile starts no desktop and no terminal.' &
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
# XFCE missing — fall back to minimal look (still labelled)
` +
      MINIMAL_SHELL
    );
  }
  if (profile === 'minimal') {
    return HEADER + MINIMAL_SHELL;
  }
  return HEADER + NONE_SHELL;
}

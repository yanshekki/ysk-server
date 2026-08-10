/**
 * Generate ~/.vnc/xstartup for desktop profiles.
 */

import type { VncDesktopProfile } from './types.js';

export function buildXstartup(profile: VncDesktopProfile): string {
  const common = `#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
[ -r "$HOME/.Xresources" ] && xrdb "$HOME/.Xresources"
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
exec xterm -geometry 80x24+10+10 -ls
`
    );
  }
  if (profile === 'minimal') {
    return (
      common +
      `if command -v openbox-session >/dev/null 2>&1; then
  openbox-session &
elif command -v twm >/dev/null 2>&1; then
  twm &
fi
exec xterm -geometry 100x30+10+10 -ls
`
    );
  }
  // none — leave a comment-only starter; user customises
  return (
    common +
    `# YSK: desktop profile "none" — replace with your session commands
exec xterm -geometry 80x24+10+10 -ls
`
  );
}

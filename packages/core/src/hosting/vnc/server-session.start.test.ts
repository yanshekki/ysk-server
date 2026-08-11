import { describe, expect, it } from 'vitest';
import { classifyVncStartFailure } from './server-session.js';

describe('classifyVncStartFailure', () => {
  it('maps missing binary', () => {
    const n = classifyVncStartFailure({
      display: 1,
      port: 5901,
      detail: 'vncserver missing',
    });
    expect(n.toLowerCase()).toMatch(/tigervnc|vncserver|install/i);
  });

  it('does not claim missing when xstartup/xterm fails', () => {
    const n = classifyVncStartFailure({
      display: 1,
      port: 5901,
      detail:
        "Session startup via '/home/u/.vnc/xstartup' exited with status 126!\nexec: xterm: Permission denied",
    });
    expect(n.toLowerCase()).not.toMatch(/tigervncserver\/vncserver|未安裝 tiger/i);
    expect(n.toLowerCase()).toMatch(/xstartup|desktop|xfce|terminal/i);
  });

  it('maps password errors', () => {
    const n = classifyVncStartFailure({
      display: 1,
      port: 5901,
      detail: 'You will require a password to access your desktops.',
    });
    expect(n.toLowerCase()).toMatch(/password|密碼/i);
  });

  it('maps port busy', () => {
    const n = classifyVncStartFailure({
      display: 1,
      port: 5901,
      detail: 'A VNC server is already running as :1',
    });
    expect(n).toMatch(/5901|:1/);
  });
});

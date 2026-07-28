import { describe, expect, it } from 'vitest';
import { webGroupProvisionCommands, YSK_WEB_GROUP } from './project-web-group.js';
import { wrapCronCommandAsLinuxUser } from './backup-cron.js';

describe('ysk-web group + cron runuser', () => {
  it('emits groupadd and usermod lines', () => {
    const cmds = webGroupProvisionCommands('ysks_abc123def456', '/home/ysk-server-x');
    expect(cmds.some((c) => c.includes(YSK_WEB_GROUP))).toBe(true);
    expect(cmds.some((c) => c.includes('usermod -aG'))).toBe(true);
    expect(cmds.some((c) => c.includes('chgrp'))).toBe(true);
  });

  it('wraps cron with runuser once', () => {
    const w = wrapCronCommandAsLinuxUser('php artisan schedule:run', 'ysks_abc');
    expect(w).toContain('runuser -u ysks_abc');
    expect(w).toContain('schedule:run');
    const double = wrapCronCommandAsLinuxUser(w, 'ysks_abc');
    expect(double).toBe(w);
  });
});

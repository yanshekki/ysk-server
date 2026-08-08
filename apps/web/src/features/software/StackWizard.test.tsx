import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StackWizard } from './StackWizard';
import { installFetchMock } from '../../test/mock-fetch';

describe('StackWizard', () => {
  it('renders plan select after stack status loads', async () => {
    installFetchMock([
      {
        match: /\/api\/v1\/system\/stack\/plans/,
        body: {
          ok: true,
          plans: [
            {
              id: 'recommended',
              title: 'Recommended',
              bundles: ['control-plane', 'web', 'database', 'defense'] },
            { id: 'minimal', title: 'Minimal', bundles: ['control-plane'] },
          ],
          bundles: [
            { id: 'web', title: 'Web', components: ['nginx'] },
            { id: 'defense', title: 'Defense', components: ['ufw'] },
          ] } },
      {
        match: /\/api\/v1\/system\/stack\/expand/,
        body: {
          ok: true,
          plan: 'recommended',
          bundles: ['control-plane', 'web', 'database', 'defense'],
          components: ['base-deps', 'nginx', 'mariadb-server', 'ufw'] } },
      {
        match: /\/api\/v1\/system\/stack/,
        body: {
          ok: true,
          manifest: { plan: 'recommended', bundles: ['control-plane', 'web'], components: {} },
          components: [
            { id: 'nginx', title: 'Nginx', inManifest: true, installed: true, bins: ['nginx'] },
          ],
          plans: [
            {
              id: 'recommended',
              title: 'Recommended',
              bundles: ['control-plane', 'web', 'database', 'defense'] },
          ],
          bundles: [{ id: 'web', title: 'Web', components: ['nginx'] }],
          executeEnabled: false,
          isRoot: false } },
    ]);

    render(<StackWizard />);
    await waitFor(() => {
      expect(screen.getByTestId('stack-wizard')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stack-plan-select')).toBeInTheDocument();
    expect(screen.getByText(/Dry-run preview/i)).toBeInTheDocument();
  });
});

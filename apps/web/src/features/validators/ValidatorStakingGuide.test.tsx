import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ValidatorPlaybookCard } from './ValidatorStakingGuide';

describe('ValidatorPlaybookCard credentials', () => {
  it('shows grouped BLS hex with copy, not a wrapping fact card', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const pub = `0x${'ab'.repeat(48)}`;
    render(
      <MemoryRouter>
        <ValidatorPlaybookCard
          chain="avax"
          variant="instance"
          nodeId="NodeID-LuxK3nnZVarpC52WEkRYr6RngbpukA29G"
          blsPublicKey={pub}
          blsProofOfPossession={`0x${'cd'.repeat(96)}`}
        />
      </MemoryRouter>,
    );
    const box = screen.getByTestId('staking-credentials');
    expect(box.querySelector('.cred-row__body--hex')?.textContent).toMatch(/0xabababab/);
    expect(box.querySelector('.cred-row__body--plain')?.textContent).toContain(
      'NodeID-LuxK3nnZVarpC52WEkRYr6RngbpukA29G',
    );
    await userEvent.click(screen.getByRole('button', { name: /Copy NodeID/i }));
    expect(writeText).toHaveBeenCalledWith('NodeID-LuxK3nnZVarpC52WEkRYr6RngbpukA29G');
  });
});

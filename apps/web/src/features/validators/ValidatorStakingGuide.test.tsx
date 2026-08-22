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

  it('shows NEAR factory, public key, and create_staking_pool command', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const pub = 'ed25519:CE3QAXyVLeScmY9YeEyR3Tw9yXfjBPzFLzroTranYtVb';
    const cmd =
      `near call pool.f863973.m0 create_staking_pool '{"staking_pool_id":"<POOL_ID>","owner_id":"<OWNER_ID>","stake_public_key":"${pub}","reward_fee_fraction":{"numerator":5,"denominator":100}}' --accountId="<OWNER_ID>" --amount=30 --gas=300000000000000`;
    render(
      <MemoryRouter>
        <ValidatorPlaybookCard
          chain="near"
          variant="instance"
          near={{
            stakePublicKey: pub,
            accountId: null,
            publicAddr: '203.0.113.9:24567',
            factoryAccount: 'pool.f863973.m0',
            poolAccountSuffix: '.pool.f863973.m0',
            storageNear: 30,
            createCommand: cmd,
          }}
        />
      </MemoryRouter>,
    );
    const box = screen.getByTestId('staking-credentials');
    expect(box.textContent).toContain(pub);
    expect(box.textContent).toContain('pool.f863973.m0');
    expect(box.textContent).toContain('create_staking_pool');
    expect(box.textContent).toContain('203.0.113.9:24567');
    expect(box.querySelector('.cred-row__body--wrap')?.textContent).toContain('create_staking_pool');
    expect(screen.getByText(/does not take this server/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Copy Stake public key/i }));
    expect(writeText).toHaveBeenCalledWith(pub);
  });

  it('shows pending copy for NEAR public key before init', () => {
    render(
      <MemoryRouter>
        <ValidatorPlaybookCard
          chain="near"
          variant="instance"
          near={{
            stakePublicKey: null,
            accountId: null,
            publicAddr: null,
            factoryAccount: 'pool.f863973.m0',
            poolAccountSuffix: '.pool.f863973.m0',
            storageNear: 30,
            createCommand:
              'near call pool.f863973.m0 create_staking_pool \'{"staking_pool_id":"<POOL_ID>"}\' --accountId="<OWNER_ID>" --amount=30 --gas=300000000000000',
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/RPC not ready does not mean the key is missing/i)).toBeInTheDocument();
    expect(screen.getByText('pool.f863973.m0')).toBeInTheDocument();
    expect(screen.getByTestId('staking-credentials').textContent).toContain('create_staking_pool');
  });

  it('shows NEAR factory before checklist keys arrive', () => {
    render(
      <MemoryRouter>
        <ValidatorPlaybookCard chain="near" variant="instance" network="testnet" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('staking-credentials').textContent).toContain('pool.f863973.m0');
    expect(screen.getByTestId('staking-credentials').textContent).toContain('create_staking_pool');
  });

  it('shows numbered next steps on the instance card', () => {
    render(
      <MemoryRouter>
        <ValidatorPlaybookCard chain="avax" variant="instance" nodeId="NodeID-abc" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('staking-next-steps').textContent).toMatch(/Core|P-Chain|NodeID/i);
  });

  it('keeps only the Hoodi launchpad on a Hoodi instance', () => {
    render(
      <MemoryRouter>
        <ValidatorPlaybookCard
          chain="eth"
          variant="instance"
          network="hoodi"
          ethBeaconUrl="http://127.0.0.1:5052"
        />
      </MemoryRouter>,
    );
    const hrefs = [...screen.getAllByRole('link')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('hoodi.launchpad.ethereum.org'))).toBe(true);
    expect(hrefs.some((h) => h === 'https://launchpad.ethereum.org')).toBe(false);
    expect(screen.getByTestId('staking-next-steps').textContent).toMatch(/validator client|beacon/i);
    expect(screen.getByText('http://127.0.0.1:5052')).toBeInTheDocument();
  });

  it('shows Cosmos create-validator command and Sui fullnode honesty', () => {
    render(
      <MemoryRouter>
        <ValidatorPlaybookCard
          chain="cosmos"
          variant="instance"
          network="testnet"
          cosmos={{
            consensusPubkey: '{"@type":"/cosmos.crypto.ed25519.PubKey","key":"abc"}',
            chainId: 'provider',
            externalAddress: 'tcp://203.0.113.8:26656',
            createCommand: 'gaiad tx staking create-validator --chain-id=provider',
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('staking-credentials').textContent).toContain('create-validator');
    expect(screen.getByTestId('staking-credentials').textContent).toContain('provider');
  });

  it('says Sui compose is a fullnode, not a validator process', () => {
    render(
      <MemoryRouter>
        <ValidatorPlaybookCard chain="sui" variant="instance" network="testnet" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/fullnode/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId('staking-next-steps').textContent).not.toMatch(
      /register as a validator from this process/i,
    );
  });
});

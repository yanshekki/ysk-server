import { describe, expect, it } from 'vitest';
import { previewInstanceId, validatorWizardCanInstall } from './validators-wizard';

describe('validatorWizardCanInstall', () => {
  it('enables install after mainnet ack even when disk is short', () => {
    expect(
      validatorWizardCanInstall({
        dockerInstalled: true,
        hasSpec: true,
        isMainnet: true,
        mainnetAck: true,
        diskShort: true,
      }),
    ).toBe(true);
  });

  it('keeps install disabled on mainnet until ack', () => {
    expect(
      validatorWizardCanInstall({
        dockerInstalled: true,
        hasSpec: true,
        isMainnet: true,
        mainnetAck: false,
        diskShort: false,
      }),
    ).toBe(false);
  });

  it('still blocks testnet when disk is short', () => {
    expect(
      validatorWizardCanInstall({
        dockerInstalled: true,
        hasSpec: true,
        isMainnet: false,
        mainnetAck: false,
        diskShort: true,
      }),
    ).toBe(false);
  });

  it('requires a safe custom path when that option is on', () => {
    expect(
      validatorWizardCanInstall({
        dockerInstalled: true,
        hasSpec: true,
        isMainnet: false,
        mainnetAck: false,
        diskShort: false,
        customPath: true,
        dataPath: '',
      }),
    ).toBe(false);
    expect(
      validatorWizardCanInstall({
        dockerInstalled: true,
        hasSpec: true,
        isMainnet: false,
        mainnetAck: false,
        diskShort: false,
        customPath: true,
        dataPath: '/var/lib/ysk-server/validators/custom',
      }),
    ).toBe(true);
  });
});

describe('previewInstanceId', () => {
  it('increments past used ids', () => {
    expect(previewInstanceId(['eth-hoodi-1'], 'eth', 'hoodi')).toBe('eth-hoodi-2');
  });
});

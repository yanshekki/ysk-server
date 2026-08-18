import { describe, expect, it } from 'vitest';
import {
  defaultUpgradePolicyForNetworkKind,
  isValidatorChainId,
  isValidatorInstanceId,
  isValidatorProfileId,
  isValidatorUpgradePolicy,
  validatorChainLabel,
  validatorDiskTone,
  validatorNetworkLabel,
  validatorNetworkLabelFor,
} from './validators.js';

describe('validators DTO helpers', () => {
  it('accepts known chain / profile / policy ids', () => {
    expect(isValidatorChainId('eth')).toBe(true);
    expect(isValidatorChainId('avax')).toBe(true);
    expect(isValidatorChainId('near')).toBe(true);
    expect(isValidatorChainId('ada')).toBe(true);
    expect(isValidatorChainId('btc')).toBe(true);
    expect(isValidatorChainId('cosmos')).toBe(true);
    expect(isValidatorChainId('sui')).toBe(true);
    expect(isValidatorChainId('aptos')).toBe(true);
    expect(isValidatorChainId('dot')).toBe(true);
    expect(isValidatorChainId('sol')).toBe(true);
    expect(isValidatorChainId('foo')).toBe(false);
    expect(isValidatorProfileId('minimal')).toBe(true);
    expect(isValidatorProfileId('archive')).toBe(false);
    expect(isValidatorUpgradePolicy('notify')).toBe(true);
    expect(isValidatorUpgradePolicy('nightly')).toBe(false);
  });

  it('keeps chain and network brand names in English', () => {
    expect(validatorChainLabel('near')).toBe('NEAR');
    expect(validatorChainLabel('sui')).toBe('Sui');
    expect(validatorChainLabel('cosmos')).toBe('Cosmos Hub');
    expect(validatorChainLabel('eth', 'Ethereum')).toBe('Ethereum');
    expect(validatorNetworkLabel('hoodi')).toBe('Hoodi');
    expect(validatorNetworkLabel('sepolia')).toBe('Sepolia');
    expect(validatorNetworkLabel('mainnet')).toBeNull();
    expect(validatorNetworkLabelFor('near', 'testnet')).toBe('NEAR Testnet');
    expect(validatorNetworkLabelFor('sol', 'testnet')).toBe('Solana Testnet');
    expect(validatorNetworkLabelFor('avax', 'fuji')).toBe('Fuji');
  });

  it('validates instance ids', () => {
    expect(isValidatorInstanceId('eth-hoodi-1')).toBe(true);
    expect(isValidatorInstanceId('avax-fuji-default')).toBe(true);
    expect(isValidatorInstanceId('ETH-hoodi-1')).toBe(false);
    expect(isValidatorInstanceId('../etc/passwd')).toBe(false);
    expect(isValidatorInstanceId('eth')).toBe(false);
  });

  it('maps disk use% to tone', () => {
    expect(validatorDiskTone(null)).toBe('ok');
    expect(validatorDiskTone(10)).toBe('ok');
    expect(validatorDiskTone(70)).toBe('warn');
    expect(validatorDiskTone(85)).toBe('danger');
    expect(validatorDiskTone(99)).toBe('danger');
  });

  it('defaults mainnet upgrades to manual', () => {
    expect(defaultUpgradePolicyForNetworkKind('mainnet')).toBe('manual');
    expect(defaultUpgradePolicyForNetworkKind('testnet')).toBe('notify');
  });
});

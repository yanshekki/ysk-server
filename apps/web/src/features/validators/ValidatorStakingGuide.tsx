/**
 * About-tab staking playbooks — official links only, no wallet connect.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  STAKING_PLAYBOOKS,
  buildCosmosCreateValidatorCommand,
  buildCosmosCreateValidatorJson,
  buildNearCreateStakingPoolCommand,
  cosmosAmountAtomLabel,
  cosmosCreateValidatorFilled,
  emptyCosmosStakingIdentity,
  emptyNearStakingIdentity,
  ethValidatorClientCommand,
  isNearOwnerAccountId,
  isNearPoolSlug,
  parseCosmosAmountUatom,
  resolveNearPoolAccountId,
  stakingPlaybookAnchor,
  stakingPlaybookLinksForInstance,
  stakingPlaybookMeta,
  validatorChainLabel,
  type CardanoProducerStatusDto,
  type CosmosStakingIdentityDto,
  type NearStakingIdentityDto,
  type SolStakingIdentityDto,
  type ValidatorChainId,
} from 'ysk-server-shared';
import {
  ActionBar,
  Alert,
  Button,
  Card,
  CardSection,
  CheckboxField,
  DataTable,
  Field,
  FormLayout,
  StructuredFacts,
  buttonClassName,
} from '../../shared/components/ui';
import { credentialCopyText, formatHexForDisplay } from './credentials-display';
import { ProducerFileDrop } from './ProducerFileDrop';

type CredItem = { label: string; value?: string | null; pending: string };

async function writeClipboard(text: string): Promise<boolean> {
  if (!text.trim()) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyBlock({
  label,
  text,
  enabled,
}: {
  label: string;
  text: string;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function onCopy() {
    if (!enabled) return;
    if (await writeClipboard(text)) {
      setState('copied');
      window.setTimeout(() => setState('idle'), 1500);
    } else {
      setState('failed');
      window.setTimeout(() => setState('idle'), 2000);
    }
  }

  const caption =
    state === 'copied'
      ? t('common.copied')
      : state === 'failed'
        ? t('validators.playbook.copyFailed')
        : t('common.copy');

  return (
    <div className="cred-row">
      <div className="cred-row__head">
        <span className="cred-row__label">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!enabled}
          onClick={() => void onCopy()}
          aria-label={t('validators.playbook.copyNamed', { label })}
        >
          {caption}
        </Button>
      </div>
      <pre className="cred-row__body cred-row__body--wrap">{text}</pre>
    </div>
  );
}

function applyPort(lines: string[], port: number): string[] {
  const p = String(port);
  return lines.map((s) => s.replaceAll('{{port}}', p).replaceAll('{p2p}', p));
}

function CredentialList({ items }: { items: CredItem[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);
  const ready = items.filter((row) => row.value?.trim());

  function flash(id: string) {
    setCopied(id);
    window.setTimeout(() => setCopied((cur) => (cur === id ? null : cur)), 1500);
  }

  async function copyOne(row: CredItem) {
    const raw = row.value?.trim();
    if (!raw) return;
    if (await writeClipboard(raw)) flash(row.label);
  }

  async function copyAll() {
    const body = credentialCopyText(ready);
    if (await writeClipboard(body)) flash('all');
  }

  if (!items.length) return null;

  return (
    <div className="cred-list" data-testid="staking-credentials">
      {items.map((row) => {
        const raw = row.value?.trim() ?? '';
        const grouped = raw ? formatHexForDisplay(raw) : null;
        return (
          <div key={row.label} className="cred-row">
            <div className="cred-row__head">
              <span className="cred-row__label">{row.label}</span>
              {raw ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void copyOne(row)}
                  aria-label={t('validators.playbook.copyNamed', { label: row.label })}
                >
                  {copied === row.label ? t('common.copied') : t('common.copy')}
                </Button>
              ) : null}
            </div>
            {raw ? (
              <pre
                className={`cred-row__body${
                  grouped
                    ? ' cred-row__body--hex'
                    : raw.includes('\n') || raw.length > 80
                      ? ' cred-row__body--wrap'
                      : ' cred-row__body--plain'
                }`}
              >
                {grouped ?? raw}
              </pre>
            ) : (
              <p className="cred-row__body cred-row__body--pending">{row.pending}</p>
            )}
          </div>
        );
      })}
      {ready.length > 1 ? (
        <div className="cred-list__foot">
          <Button type="button" variant="secondary" size="sm" onClick={() => void copyAll()}>
            {copied === 'all' ? t('common.copied') : t('validators.playbook.copyAll')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function playbookList(
  t: (key: string, opts?: { returnObjects?: boolean }) => unknown,
  chain: string,
  field: 'yskDoes' | 'youDo' | 'steps' | 'never',
): string[] {
  const raw = t(`validators.playbook.${chain}.${field}`, { returnObjects: true });
  return Array.isArray(raw) ? raw.map(String).filter((s) => s.trim()) : [];
}

export function ValidatorStakingGuide() {
  const { t } = useTranslation();
  return (
    <div className="stack">
      <Alert variant="info">{t('validators.playbook.overviewDesc')}</Alert>
      <DataTable
        title={t('validators.playbook.overviewTitle')}
        rowKey={(row) => row.chain}
        rows={[...STAKING_PLAYBOOKS]}
        columns={[
          {
            key: 'chain',
            header: t('validators.playbook.colChain'),
            render: (row) => (
              <a href={`#${stakingPlaybookAnchor(row.chain)}`}>
                <strong>{validatorChainLabel(row.chain)}</strong>
              </a>
            ),
          },
          {
            key: 'model',
            header: t('validators.playbook.colModel'),
            render: (row) => t(`validators.playbook.${row.chain}.model`),
          },
          {
            key: 'min',
            header: t('validators.playbook.colMin'),
            render: (row) => t(`validators.playbook.${row.chain}.min`),
          },
          {
            key: 'wallets',
            header: t('validators.playbook.colWallet'),
            render: (row) => t(`validators.playbook.${row.chain}.wallets`),
          },
          {
            key: 'panel',
            header: t('validators.playbook.colPanel'),
            render: (row) => t(`validators.playbook.${row.chain}.panel`),
          },
        ]}
      />
      {STAKING_PLAYBOOKS.map((row) => (
        <ValidatorPlaybookCard key={row.chain} chain={row.chain} />
      ))}
    </div>
  );
}

export function ValidatorPlaybookCard({
  chain,
  compact,
  variant,
  nodeId,
  blsPublicKey,
  blsProofOfPossession,
  near,
  cosmos,
  sol,
  adaP2pPort,
  p2pPort,
  ethBeaconUrl,
  ethCl,
  network,
  cardanoProducer,
  producerMainnet,
  onProducerApply,
  onProducerDetach,
  instanceId,
  onNearAccount,
}: {
  chain: string;
  compact?: boolean;
  variant?: 'full' | 'compact' | 'instance';
  nodeId?: string | null;
  blsPublicKey?: string | null;
  blsProofOfPossession?: string | null;
  near?: NearStakingIdentityDto | null;
  cosmos?: CosmosStakingIdentityDto | null;
  sol?: SolStakingIdentityDto | null;
  adaP2pPort?: number | null;
  p2pPort?: number | null;
  ethBeaconUrl?: string | null;
  ethCl?: string | null;
  network?: string;
  instanceId?: string;
  onNearAccount?: (input: { poolSlug: string; restart: boolean }) => void;
  cardanoProducer?: CardanoProducerStatusDto | null;
  producerMainnet?: boolean;
  onProducerApply?: (files: { kes?: string; vrf?: string; opcert?: string }) => void;
  onProducerDetach?: () => void;
}) {
  const { t } = useTranslation();
  const meta = stakingPlaybookMeta(chain);
  if (!meta) return null;
  const id = chain as ValidatorChainId;
  const mode = variant ?? (compact ? 'compact' : 'full');
  const yskDoes = playbookList(t, id, 'yskDoes');
  const youDo = playbookList(t, id, 'youDo');
  const never = playbookList(t, id, 'never');
  const aboutHref = `/validators?tab=about#${stakingPlaybookAnchor(id)}`;

  if (mode === 'compact') {
    return (
      <Alert variant={meta.model === 'not-pos' ? 'info' : 'warn'}>
        <p className="u-mb-0">
          <strong>{validatorChainLabel(id)}</strong>
          {' — '}
          {t(`validators.playbook.${id}.model`)}
        </p>
        <p className="u-mb-0 u-mt-2 u-text-sm">
          {t(`validators.playbook.${id}.min`)}
          {' · '}
          {t(`validators.playbook.${id}.wallets`)}
        </p>
        <p className="u-mb-0 u-mt-2">
          <Link to={aboutHref}>{t('validators.playbook.seeAbout')}</Link>
        </p>
      </Alert>
    );
  }

  const avaxCredentials =
    id === 'avax'
      ? [
          {
            label: t('validators.playbook.nodeIdReady'),
            value: nodeId,
            pending: t('validators.playbook.nodeIdPending'),
          },
          {
            label: t('validators.playbook.blsReady'),
            value: blsPublicKey,
            pending: t('validators.playbook.blsPending'),
          },
          {
            label: t('validators.playbook.blsProof'),
            value: blsProofOfPossession,
            pending: t('validators.playbook.blsPending'),
          },
        ]
      : [];

  const nearIdent =
    id === 'near' ? (near ?? (network ? emptyNearStakingIdentity(network) : null)) : null;
  const nearPort = p2pPort ?? 24567;
  const nearCredentials =
    id === 'near' && nearIdent
      ? [
          {
            label: t('validators.playbook.nearStakeKey'),
            value: nearIdent.stakePublicKey,
            pending: t('validators.playbook.nearStakeKeyPending'),
          },
          {
            label: t('validators.playbook.nearAccountId'),
            value: nearIdent.accountId,
            pending: t('validators.playbook.nearAccountIdPending', { suffix: nearIdent.poolAccountSuffix }),
          },
          {
            label: t('validators.playbook.nearFactory'),
            value: nearIdent.factoryAccount,
            pending: t('validators.playbook.nearFactory'),
          },
          {
            label: t('validators.playbook.nearPublicAddr'),
            value: nearIdent.publicAddr,
            pending: t('validators.playbook.nearPublicAddrPending', { port: nearPort }),
          },
          ...(mode === 'instance'
            ? []
            : [
                {
                  label: t('validators.playbook.nearCreateCommand'),
                  value: nearIdent.createCommand,
                  pending: t('validators.playbook.nearCreateCommand'),
                },
              ]),
        ]
      : [];

  const cosmosIdent =
    id === 'cosmos' ? (cosmos ?? (network ? emptyCosmosStakingIdentity(network) : null)) : null;
  const cosmosPort = p2pPort ?? 26656;
  const cosmosCredentials =
    id === 'cosmos' && cosmosIdent
      ? [
          {
            label: t('validators.playbook.cosmosPubkey'),
            value: cosmosIdent.consensusPubkey,
            pending: t('validators.playbook.cosmosPubkeyPending'),
          },
          {
            label: t('validators.playbook.cosmosChainId'),
            value: cosmosIdent.chainId,
            pending: t('validators.playbook.cosmosChainId'),
          },
          {
            label: t('validators.playbook.cosmosP2p'),
            value: cosmosIdent.externalAddress,
            pending: t('validators.playbook.cosmosP2pPending', { port: cosmosPort }),
          },
          ...(mode === 'instance'
            ? []
            : [
                {
                  label: t('validators.playbook.cosmosCreateJson'),
                  value: cosmosIdent.createValidatorJson,
                  pending: t('validators.playbook.cosmosCreateJson'),
                },
                {
                  label: t('validators.playbook.cosmosCreateCommand'),
                  value: cosmosIdent.createCommand,
                  pending: t('validators.playbook.cosmosCreateCommand'),
                },
              ]),
        ]
      : [];

  const ethVcCommand =
    id === 'eth' && ethBeaconUrl
      ? ethValidatorClientCommand({
          network: network ?? 'hoodi',
          beaconUrl: ethBeaconUrl,
          cl: ethCl,
        })
      : null;
  const ethCredentials =
    id === 'eth'
      ? [
          {
            label: t('validators.playbook.ethBeacon'),
            value: ethBeaconUrl,
            pending: t('validators.playbook.ethBeaconPending'),
          },
          {
            label: t('validators.playbook.ethVcCommand'),
            value: ethVcCommand,
            pending: t('validators.playbook.ethVcHint'),
          },
        ]
      : [];

  const solCredentials =
    id === 'sol'
      ? [
          {
            label: t('validators.playbook.solIdentity'),
            value: sol?.identityPubkey,
            pending: t('validators.playbook.solIdentityPending'),
          },
        ]
      : [];

  const adaCredentials =
    id === 'ada'
      ? [
          {
            label: t('validators.playbook.adaP2pPort'),
            value: String(adaP2pPort ?? p2pPort ?? 3001),
            pending: t('validators.playbook.adaP2pPending'),
          },
        ]
      : [];

  const credentials = [
    ...avaxCredentials,
    ...nearCredentials,
    ...cosmosCredentials,
    ...solCredentials,
    ...adaCredentials,
    ...ethCredentials,
  ];

  const shownLinks =
    mode === 'instance' ? stakingPlaybookLinksForInstance(id, network ?? '') : meta.links;

  const honestyKey = `validators.playbook.${id}.honesty`;
  const honesty = t(honestyKey);
  const honestyText = honesty === honestyKey ? '' : honesty;
  const stepPort =
    id === 'cosmos'
      ? cosmosPort
      : id === 'near'
        ? nearPort
        : id === 'ada'
          ? (adaP2pPort ?? p2pPort ?? 3001)
          : (p2pPort ?? 0);
  const steps = applyPort(playbookList(t, id, 'steps'), stepPort);

  const officialLinks = (
    <ActionBar>
      {shownLinks.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          {l.label}
        </a>
      ))}
      {mode === 'instance' ? (
        <Link to={aboutHref} className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
          {t('validators.playbook.seeAbout')}
        </Link>
      ) : null}
    </ActionBar>
  );

  if (mode === 'instance') {
    return (
      <CardSection
        title={t('validators.stake.title')}
        description={t(`validators.playbook.${id}.model`)}
      >
        {meta.model === 'not-pos' ? (
          <Alert variant="info">{t('validators.playbook.notPosBody')}</Alert>
        ) : null}
        <StructuredFacts
          items={[
            {
              label: t('validators.playbook.colMin'),
              value: t(`validators.playbook.${id}.min`),
            },
            {
              label: t('validators.playbook.colWallet'),
              value: t(`validators.playbook.${id}.wallets`),
            },
          ]}
        />
        {id === 'near' ? (
          <Alert variant="info">{t('validators.playbook.nearPointing', { port: nearPort })}</Alert>
        ) : null}
        {id === 'cosmos' ? (
          <Alert variant="info">{t('validators.playbook.cosmosPointing', { port: cosmosPort })}</Alert>
        ) : null}
        {id === 'avax' ? <Alert variant="info">{t('validators.playbook.avaxPointing')}</Alert> : null}
        {honestyText ? <Alert variant="info">{honestyText}</Alert> : null}
        <CredentialList items={credentials} />
        {id === 'near' && nearIdent ? (
          <>
            <NearPoolForm
              ident={nearIdent}
              network={network ?? 'testnet'}
              instanceId={instanceId}
              onWrite={onNearAccount}
            />
            <p className="muted u-text-sm">
              {t('validators.playbook.nearAccountIdHint', { suffix: nearIdent.poolAccountSuffix })}
            </p>
          </>
        ) : null}
        {id === 'cosmos' && cosmosIdent ? (
          <CosmosValidatorForm ident={cosmosIdent} network={network ?? 'testnet'} />
        ) : null}
        {id === 'ada' && onProducerApply ? (
          <CardanoProducerAttach
            status={cardanoProducer}
            mainnet={producerMainnet === true}
            onApply={onProducerApply}
            onDetach={onProducerDetach}
          />
        ) : null}
        {steps.length ? (
          <>
            <h3 className="u-text-sm">{t('validators.playbook.steps')}</h3>
            <ol className="list-plain" data-testid="staking-next-steps">
              {steps.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </>
        ) : null}
        {never.length ? (
          <Alert variant="warn">
            <strong>{t('validators.playbook.never')}</strong>
            <ul className="list-plain u-mb-0">
              {never.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {officialLinks}
      </CardSection>
    );
  }

  return (
    <Card>
      <div id={stakingPlaybookAnchor(id)}>
        <CardSection title={validatorChainLabel(id)} description={t(`validators.playbook.${id}.model`)}>
          {meta.model === 'not-pos' ? (
            <Alert variant="info">{t('validators.playbook.notPosBody')}</Alert>
          ) : null}
          <StructuredFacts
            items={[
              {
                label: t('validators.playbook.colMin'),
                value: t(`validators.playbook.${id}.min`),
              },
              {
                label: t('validators.playbook.colWallet'),
                value: t(`validators.playbook.${id}.wallets`),
              },
              {
                label: t('validators.playbook.colPanel'),
                value: t(`validators.playbook.${id}.panel`),
              },
            ]}
          />
          {id === 'near' ? (
            <Alert variant="info">{t('validators.playbook.nearPointing', { port: nearPort })}</Alert>
          ) : null}
          {honestyText ? <Alert variant="info">{honestyText}</Alert> : null}
          <CredentialList items={credentials} />
          <FormLayout columns={2}>
            <div>
              <h3 className="u-text-sm">{t('validators.playbook.yskDoes')}</h3>
              <ul className="list-plain">
                {yskDoes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="u-text-sm">{t('validators.playbook.youDo')}</h3>
              <ul className="list-plain">
                {youDo.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </FormLayout>
          <h3 className="u-text-sm">{t('validators.playbook.steps')}</h3>
          <ol className="list-plain">
            {steps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          {never.length ? (
            <Alert variant="warn">
              <strong>{t('validators.playbook.never')}</strong>
              <ul className="list-plain u-mb-0">
                {never.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <h3 className="u-text-sm">{t('validators.playbook.official')}</h3>
          {officialLinks}
        </CardSection>
      </div>
    </Card>
  );
}

function NearPoolForm({
  ident,
  network,
  instanceId,
  onWrite,
}: {
  ident: NearStakingIdentityDto;
  network: string;
  instanceId?: string;
  onWrite?: (input: { poolSlug: string; restart: boolean }) => void;
}) {
  const { t } = useTranslation();
  const [poolSlug, setPoolSlug] = useState(() => {
    const resolved = resolveNearPoolAccountId({ network, accountId: ident.accountId });
    return resolved.ok ? resolved.poolSlug : '';
  });
  const [ownerId, setOwnerId] = useState('');
  const [restart, setRestart] = useState(true);
  const slugOk = isNearPoolSlug(poolSlug);
  const ownerOk = isNearOwnerAccountId(ownerId);
  const command = buildNearCreateStakingPoolCommand({
    network,
    stakePublicKey: ident.stakePublicKey,
    poolId: poolSlug,
    ownerId,
  });
  const canWrite = Boolean(instanceId && onWrite && ident.stakePublicKey && slugOk);
  const commandReady = Boolean(ident.stakePublicKey && slugOk && ownerOk);

  return (
    <div className="stack" data-testid="near-pool-form">
      {!ident.stakePublicKey ? (
        <Alert variant="info">{t('validators.playbook.nearNeedKey')}</Alert>
      ) : null}
      <FormLayout columns={2}>
        <Field
          htmlFor="near-pool-slug"
          label={t('validators.playbook.nearPoolSlug')}
          hint={t('validators.playbook.nearPoolSlugHint', { suffix: ident.poolAccountSuffix })}
          error={poolSlug && !slugOk ? t('validators.errors.nearAccountInvalid') : undefined}
        >
          <input
            id="near-pool-slug"
            className="input"
            autoComplete="off"
            value={poolSlug}
            onChange={(e) => setPoolSlug(e.target.value.trim().toLowerCase())}
          />
        </Field>
        <Field
          htmlFor="near-owner"
          label={t('validators.playbook.nearOwner')}
          hint={t('validators.playbook.nearOwnerHint')}
        >
          <input
            id="near-owner"
            className="input"
            autoComplete="off"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value.trim().toLowerCase())}
          />
        </Field>
      </FormLayout>
      <CopyBlock
        label={t('validators.playbook.nearPreview')}
        text={command}
        enabled={commandReady}
      />
      {instanceId && onWrite ? (
        <>
          <CheckboxField
            id="near-restart"
            label={t('validators.playbook.nearRestart')}
            checked={restart}
            onChange={setRestart}
          />
          <ActionBar>
            <Button
              type="button"
              variant="primary"
              disabled={!canWrite}
              onClick={() => onWrite({ poolSlug, restart })}
            >
              {t('validators.playbook.nearWriteAccount')}
            </Button>
          </ActionBar>
        </>
      ) : null}
      {!slugOk ? (
        <p className="muted u-text-sm">{t('validators.playbook.nearNeedSlug')}</p>
      ) : !ownerOk ? (
        <p className="muted u-text-sm">{t('validators.playbook.nearNeedOwner')}</p>
      ) : null}
    </div>
  );
}

function CosmosValidatorForm({
  ident,
  network,
}: {
  ident: CosmosStakingIdentityDto;
  network: string;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [moniker, setMoniker] = useState('');
  const [fromKey, setFromKey] = useState('');
  const parsedAmount = parseCosmosAmountUatom(amount);
  const atomHint = parsedAmount ? cosmosAmountAtomLabel(parsedAmount) : null;
  const json = buildCosmosCreateValidatorJson({
    consensusPubkey: ident.consensusPubkey,
    amountUatom: amount,
    moniker,
  });
  const command = buildCosmosCreateValidatorCommand({
    network,
    consensusPubkey: ident.consensusPubkey,
    amountUatom: amount,
    moniker,
    fromKey,
  });
  const fieldsFilled = cosmosCreateValidatorFilled({
    consensusPubkey: ident.consensusPubkey,
    amountUatom: amount,
    moniker,
    fromKey,
  });

  return (
    <div className="stack" data-testid="cosmos-validator-form">
      {!ident.consensusPubkey ? (
        <Alert variant="info">{t('validators.playbook.cosmosNeedPubkey')}</Alert>
      ) : null}
      <FormLayout columns={2}>
        <Field
          htmlFor="cosmos-amount"
          label={t('validators.playbook.cosmosAmount')}
          hint={
            atomHint
              ? t('validators.playbook.cosmosAmountParsed', { amount: parsedAmount, atom: atomHint })
              : t('validators.playbook.cosmosAmountHint')
          }
        >
          <input
            id="cosmos-amount"
            className="input"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1atom"
          />
        </Field>
        <Field htmlFor="cosmos-moniker" label={t('validators.playbook.cosmosMoniker')}>
          <input
            id="cosmos-moniker"
            className="input"
            autoComplete="off"
            value={moniker}
            onChange={(e) => setMoniker(e.target.value)}
          />
        </Field>
        <Field
          htmlFor="cosmos-from"
          label={t('validators.playbook.cosmosFromKey')}
          hint={t('validators.playbook.cosmosFromHint')}
        >
          <input
            id="cosmos-from"
            className="input"
            autoComplete="off"
            value={fromKey}
            onChange={(e) => setFromKey(e.target.value.trim())}
          />
        </Field>
      </FormLayout>
      <CopyBlock
        label={t('validators.playbook.cosmosCreateJson')}
        text={json}
        enabled={fieldsFilled}
      />
      <CopyBlock
        label={t('validators.playbook.cosmosCreateCommand')}
        text={command}
        enabled={fieldsFilled}
      />
      {!fieldsFilled ? (
        <p className="muted u-text-sm">{t('validators.playbook.cosmosNeedFields')}</p>
      ) : null}
    </div>
  );
}

async function fileToProducerPayload(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder().decode(buf).trim();
  if (text.startsWith('{') || text.startsWith('[')) return text;
  let bin = '';
  buf.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

type ProducerPick = { name: string; payload: string };

function CardanoProducerAttach({
  status,
  mainnet,
  onApply,
  onDetach,
}: {
  status?: CardanoProducerStatusDto | null;
  mainnet: boolean;
  onApply: (files: { kes?: string; vrf?: string; opcert?: string }) => void;
  onDetach?: () => void;
}) {
  const { t } = useTranslation();
  const [kes, setKes] = useState<ProducerPick | undefined>();
  const [vrf, setVrf] = useState<ProducerPick | undefined>();
  const [opcert, setOpcert] = useState<ProducerPick | undefined>();

  function take(file: File, setPick: (p: ProducerPick) => void) {
    void fileToProducerPayload(file).then((payload) => setPick({ name: file.name, payload }));
  }

  return (
    <div className="val-producer" data-testid="cardano-producer">
      <Alert variant="warn">{t('validators.producer.warn')}</Alert>
      <p className="val-producer__hint muted u-text-sm">{t('validators.producer.hint')}</p>
      <div className="val-producer__slots">
        <ProducerFileDrop
          id="ada-kes"
          label={t('validators.producer.kes')}
          fileHint="kes.skey"
          present={status?.kesPresent}
          fingerprint={status?.kesFp}
          queuedName={kes?.name}
          onFile={(f) => take(f, setKes)}
          onClear={() => setKes(undefined)}
        />
        <ProducerFileDrop
          id="ada-vrf"
          label={t('validators.producer.vrf')}
          fileHint="vrf.skey"
          present={status?.vrfPresent}
          fingerprint={status?.vrfFp}
          queuedName={vrf?.name}
          onFile={(f) => take(f, setVrf)}
          onClear={() => setVrf(undefined)}
        />
        <ProducerFileDrop
          id="ada-opcert"
          label={t('validators.producer.opcert')}
          fileHint="node.cert"
          present={status?.opcertPresent}
          fingerprint={status?.opcertFp}
          queuedName={opcert?.name}
          onFile={(f) => take(f, setOpcert)}
          onClear={() => setOpcert(undefined)}
        />
      </div>
      <ActionBar className="val-producer__actions">
        <Button
          variant="primary"
          disabled={!kes && !vrf && !opcert}
          onClick={() => onApply({ kes: kes?.payload, vrf: vrf?.payload, opcert: opcert?.payload })}
        >
          {t('validators.producer.apply')}
        </Button>
        {status?.kesPresent || status?.vrfPresent || status?.opcertPresent ? (
          <Button variant="secondary" onClick={() => onDetach?.()}>
            {t('validators.producer.detach')}
          </Button>
        ) : null}
      </ActionBar>
      {mainnet ? <p className="muted u-text-sm">{t('validators.producer.mainnet')}</p> : null}
    </div>
  );
}

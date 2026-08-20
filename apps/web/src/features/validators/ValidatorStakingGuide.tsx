/**
 * About-tab staking playbooks — official links only, no wallet connect.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  STAKING_PLAYBOOKS,
  stakingPlaybookAnchor,
  stakingPlaybookMeta,
  validatorChainLabel,
  type ValidatorChainId,
} from 'ysk-server-shared';
import {
  ActionBar,
  Alert,
  Button,
  Card,
  CardSection,
  DataTable,
  FormLayout,
  StructuredFacts,
  buttonClassName,
} from '../../shared/components/ui';
import { credentialCopyText, formatHexForDisplay } from './credentials-display';

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
                className={`cred-row__body${grouped ? ' cred-row__body--hex' : ' cred-row__body--plain'}`}
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
}: {
  chain: string;
  compact?: boolean;
  variant?: 'full' | 'compact' | 'instance';
  nodeId?: string | null;
  blsPublicKey?: string | null;
  blsProofOfPossession?: string | null;
}) {
  const { t } = useTranslation();
  const meta = stakingPlaybookMeta(chain);
  if (!meta) return null;
  const id = chain as ValidatorChainId;
  const mode = variant ?? (compact ? 'compact' : 'full');
  const yskDoes = playbookList(t, id, 'yskDoes');
  const youDo = playbookList(t, id, 'youDo');
  const steps = playbookList(t, id, 'steps');
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

  const officialLinks = (
    <ActionBar>
      {meta.links.map((l) => (
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
        <CredentialList items={avaxCredentials} />
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
          <CredentialList items={avaxCredentials} />
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

/**
 * About-tab staking playbooks — official links only, no wallet connect.
 */
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
  Card,
  CardSection,
  DataTable,
  FormLayout,
  StructuredFacts,
  buttonClassName,
} from '../../shared/components/ui';

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

  const avaxFacts =
    id === 'avax'
      ? [
          {
            label: t('validators.playbook.nodeIdReady'),
            value: nodeId ? <code>{nodeId}</code> : t('validators.playbook.nodeIdPending'),
          },
          {
            label: t('validators.playbook.blsReady'),
            value: blsPublicKey ? (
              <code>{blsPublicKey}</code>
            ) : (
              t('validators.playbook.blsPending')
            ),
          },
          {
            label: t('validators.playbook.blsProof'),
            value: blsProofOfPossession ? (
              <code>{blsProofOfPossession}</code>
            ) : (
              t('validators.playbook.blsPending')
            ),
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
            ...avaxFacts,
          ]}
        />
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
              ...avaxFacts,
            ]}
          />
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

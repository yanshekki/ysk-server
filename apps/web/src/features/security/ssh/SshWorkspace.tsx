/**
 * SSH workspace — one place for outbound identities + login keys + sshd.
 * Job-to-be-done UX, not raw crypto dump.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  PageTabs,
} from '../../../shared/components/ui';
import { OutboundIdentities } from './OutboundIdentities';
import { LoginKeysPanel } from './LoginKeysPanel';
import { SshdPanel } from './SshdPanel';
import { Ssh2faPanel } from './Ssh2faPanel';
import { sshApi } from './api';
import type { SshSubTab } from './types';
import { bindSet } from '../../../pages/bind-handlers';

export function SshWorkspace(props: {
  /** Called so parent FeaturePageLayout status can show counts */
  onCounts?: (c: { identities: number; loginKeys: number }) => void;
}) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('ssh');
  const sub: SshSubTab =
    raw === 'login' || raw === 'sshd' || raw === 'outbound' || raw === '2fa'
      ? raw
      : 'outbound';

  const [identitiesN, setIdentitiesN] = useState(0);
  const [loginN, setLoginN] = useState(0);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'error'; text: string } | null>(
    null,
  );

  const setSub = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set('tab', 'ssh');
      next.set('ssh', id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const refreshCounts = useCallback(async () => {
    try {
      const [ids, keys] = await Promise.all([
        sshApi.listIdentities(),
        sshApi.listLoginKeys(),
      ]);
      const ic = (ids.items ?? []).filter((i) => i.status !== 'retired').length;
      const lc = (keys.items ?? []).length;
      setIdentitiesN(ic);
      setLoginN(lc);
      props.onCounts?.({ identities: ic, loginKeys: lc });
    } catch {
      /* ignore */
    }
  }, [props]);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts, sub]);

  const subs = useMemo(
    () =>
      [
        {
          id: 'outbound' as const,
          label: t('security.ssh.subOutbound'),
          hint: t('security.ssh.subOutboundHint'),
        },
        {
          id: 'login' as const,
          label: t('security.ssh.subLogin'),
          hint: t('security.ssh.subLoginHint'),
        },
        {
          id: '2fa' as const,
          label: t('security.ssh.sub2fa'),
          hint: t('security.ssh.sub2faHint'),
        },
        {
          id: 'sshd' as const,
          label: t('security.ssh.subSshd'),
          hint: t('security.ssh.subSshdHint'),
        },
      ] as const,
    [t],
  );

  const flashEl = flash ? (
    <Alert variant={flash.tone === 'ok' ? 'ok' : 'error'}>
      {flash.text}{' '}
      <Button variant="ghost" size="sm" onClick={bindSet(setFlash, null)}>
        {t('common.close')}
      </Button>
    </Alert>
  ) : null;

  const jobCards = useMemo(
    () => (
      <div className="ssh-jobs">
        <button
          type="button"
          className={`ssh-job${sub === 'outbound' ? ' is-on' : ''}`}
          onClick={bindSet(setSub, 'outbound')}
        >
          <span className="ssh-job__icon" aria-hidden>
            ↗
          </span>
          <span className="ssh-job__body">
            <strong>{t('security.ssh.jobOutboundTitle')}</strong>
            <span className="muted u-text-sm">{t('security.ssh.jobOutboundDesc')}</span>
          </span>
          <Badge tone={identitiesN ? 'ok' : 'neutral'}>{identitiesN || '—'}</Badge>
        </button>
        <button
          type="button"
          className={`ssh-job${sub === 'login' ? ' is-on' : ''}`}
          onClick={bindSet(setSub, 'login')}
        >
          <span className="ssh-job__icon" aria-hidden>
            ↙
          </span>
          <span className="ssh-job__body">
            <strong>{t('security.ssh.jobLoginTitle')}</strong>
            <span className="muted u-text-sm">{t('security.ssh.jobLoginDesc')}</span>
          </span>
          <Badge tone={loginN ? 'info' : 'neutral'}>{loginN || '—'}</Badge>
        </button>
        <button
          type="button"
          className={`ssh-job${sub === '2fa' ? ' is-on' : ''}`}
          onClick={bindSet(setSub, '2fa')}
        >
          <span className="ssh-job__icon" aria-hidden>
            2
          </span>
          <span className="ssh-job__body">
            <strong>{t('security.ssh.job2faTitle')}</strong>
            <span className="muted u-text-sm">{t('security.ssh.job2faDesc')}</span>
          </span>
        </button>
        <button
          type="button"
          className={`ssh-job${sub === 'sshd' ? ' is-on' : ''}`}
          onClick={bindSet(setSub, 'sshd')}
        >
          <span className="ssh-job__icon" aria-hidden>
            ⚙
          </span>
          <span className="ssh-job__body">
            <strong>{t('security.ssh.jobSshdTitle')}</strong>
            <span className="muted u-text-sm">{t('security.ssh.jobSshdDesc')}</span>
          </span>
        </button>
      </div>
    ),
    [sub, setSub, identitiesN, loginN, t],
  );

  return (
    <div className="tab-panel stack-gap">
      {flashEl}

      <Card>
        <CardSection
          title={t('security.ssh.workspaceTitle')}
          description={t('security.ssh.workspaceDesc')}
        >
          {jobCards}
        </CardSection>
      </Card>

      <PageTabs
        tabs={subs.map((s) => ({
          id: s.id,
          label: s.label,
          badge:
            s.id === 'outbound'
              ? identitiesN || undefined
              : s.id === 'login'
                ? loginN || undefined
                : undefined,
        }))}
        active={sub}
        onChange={setSub}
        variant="scroll"
      >
        {sub === 'outbound' ? (
          <OutboundIdentities
            onFlash={(tone, text) => setFlash({ tone, text })}
            onChanged={() => void refreshCounts()}
          />
        ) : null}
        {sub === 'login' ? (
          <LoginKeysPanel
            onFlash={(tone, text) => setFlash({ tone, text })}
            onChanged={() => void refreshCounts()}
          />
        ) : null}
        {sub === '2fa' ? (
          <Ssh2faPanel onFlash={(tone, text) => setFlash({ tone, text })} />
        ) : null}
        {sub === 'sshd' ? (
          <SshdPanel onFlash={(tone, text) => setFlash({ tone, text })} />
        ) : null}
      </PageTabs>
    </div>
  );
}

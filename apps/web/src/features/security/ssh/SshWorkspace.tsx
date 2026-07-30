/**
 * SSH workspace — one place for outbound identities + login keys + sshd.
 * Job-to-be-done UX, not raw crypto dump.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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

const SUBS: { id: SshSubTab; label: string; hint: string }[] = [
  { id: 'outbound', label: '出站身份', hint: '面板／專案出去用的私鑰' },
  { id: 'login', label: '登入授權', hint: '誰可以 SFTP／SSH 進來' },
  { id: '2fa', label: '登入 2FA', hint: 'SSH TOTP（≠ panel 2FA）' },
  { id: 'sshd', label: '系統 sshd', hint: '專案用戶 SFTP 設定' },
];

export function SshWorkspace(props: {
  /** Called so parent FeaturePageLayout status can show counts */
  onCounts?: (c: { identities: number; loginKeys: number }) => void;
}) {
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

  const flashEl = flash ? (
    <Alert variant={flash.tone === 'ok' ? 'ok' : 'error'}>
      {flash.text}{' '}
      <Button variant="ghost" size="sm" onClick={() => setFlash(null)}>
        關閉
      </Button>
    </Alert>
  ) : null;

  const jobCards = useMemo(
    () => (
      <div className="ssh-jobs">
        <button
          type="button"
          className={`ssh-job${sub === 'outbound' ? ' is-on' : ''}`}
          onClick={() => setSub('outbound')}
        >
          <span className="ssh-job__icon" aria-hidden>
            ↗
          </span>
          <span className="ssh-job__body">
            <strong>我要連出去</strong>
            <span className="muted u-text-sm">
              建立出站身份金鑰 · 面板 peer／專案 git
            </span>
          </span>
          <Badge tone={identitiesN ? 'ok' : 'neutral'}>{identitiesN || '—'}</Badge>
        </button>
        <button
          type="button"
          className={`ssh-job${sub === 'login' ? ' is-on' : ''}`}
          onClick={() => setSub('login')}
        >
          <span className="ssh-job__icon" aria-hidden>
            ↙
          </span>
          <span className="ssh-job__body">
            <strong>我要讓人登入</strong>
            <span className="muted u-text-sm">登記公鑰到專案 home · authorized_keys</span>
          </span>
          <Badge tone={loginN ? 'info' : 'neutral'}>{loginN || '—'}</Badge>
        </button>
        <button
          type="button"
          className={`ssh-job${sub === '2fa' ? ' is-on' : ''}`}
          onClick={() => setSub('2fa')}
        >
          <span className="ssh-job__icon" aria-hidden>
            2
          </span>
          <span className="ssh-job__body">
            <strong>SSH 登入要 2FA</strong>
            <span className="muted u-text-sm">Linux 用戶 TOTP（與 panel 2FA 分開）</span>
          </span>
        </button>
        <button
          type="button"
          className={`ssh-job${sub === 'sshd' ? ' is-on' : ''}`}
          onClick={() => setSub('sshd')}
        >
          <span className="ssh-job__icon" aria-hidden>
            ⚙
          </span>
          <span className="ssh-job__body">
            <strong>系統要能 SFTP</strong>
            <span className="muted u-text-sm">安裝 sshd Match 片段（專案用戶）</span>
          </span>
        </button>
      </div>
    ),
    [sub, setSub, identitiesN, loginN],
  );

  return (
    <div className="tab-panel stack-gap">
      {flashEl}

      <Card>
        <CardSection
          title="SSH 工作台"
          description="先選你要完成的事。登入公鑰 ≠ 出站私鑰，兩邊分開管理更安全。"
        >
          {jobCards}
        </CardSection>
      </Card>

      <PageTabs
        tabs={SUBS.map((s) => ({
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

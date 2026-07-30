import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionBar,
  Badge,
  Button,
  CheckboxField,
  Field,
  FormHint,
  FormLayout,
  Modal,
  SegRadio,
} from '../../../shared/components/ui';
import { projectsApi } from '../api';
import { formatRuntimeName } from '../model/runtime-ui';
import {
  defaultRuntimeInstallVersion,
  runtimeVersionChoices,
} from '../model/deploy-prefs';

export interface ProjectCreateModalProps {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  onSubmit: (input: {
    name: string;
    domain?: string;
    domainAliases?: string[];
    runtime: 'node' | 'php' | 'static' | 'python' | 'go' | 'rust';
    runtimeVersion?: string;
    templateId?: string;
    createDnsZone?: boolean;
    createMailDomain?: boolean;
    serverIp?: string;
    serverIpv6?: string;
  }) => Promise<void>;
}

export function ProjectCreateModal({
  open,
  onClose,
  busy,
  onSubmit,
}: ProjectCreateModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [aliases, setAliases] = useState('');
  const [runtime, setRuntime] = useState<
    'node' | 'php' | 'static' | 'python' | 'go' | 'rust'
  >('node');
  const [runtimeVersion, setRuntimeVersion] = useState(() =>
    defaultRuntimeInstallVersion('node'),
  );
  const [templateId, setTemplateId] = useState('');
  const [createDns, setCreateDns] = useState(false);
  const [createMail, setCreateMail] = useState(false);
  const [serverIp, setServerIp] = useState('');
  const [serverIpv6, setServerIpv6] = useState('');
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; description: string; runtime: string }>
  >([]);

  const versionChoices = useMemo(
    () => runtimeVersionChoices(runtime),
    [runtime],
  );

  useEffect(() => {
    if (!open) return;
    void projectsApi
      .listTemplates()
      .then((r) => setTemplates(r.items))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setName('');
      setDomain('');
      setAliases('');
      setRuntime('node');
      setRuntimeVersion(defaultRuntimeInstallVersion('node'));
      setTemplateId('');
      setCreateDns(false);
      setCreateMail(false);
      setServerIp('');
      setServerIpv6('');
    }
  }, [open]);

  function applyRuntime(next: typeof runtime) {
    setRuntime(next);
    const choices = runtimeVersionChoices(next);
    const def = defaultRuntimeInstallVersion(next);
    setRuntimeVersion(choices.includes(def) ? def : choices[0] ?? '');
    const tpl = templates.find((x) => x.id === templateId);
    if (tpl && tpl.runtime !== next) setTemplateId('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const domainAliases = aliases
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await onSubmit({
      name,
      domain: domain || undefined,
      domainAliases: domainAliases.length ? domainAliases : undefined,
      runtime,
      runtimeVersion:
        runtime !== 'static' && runtimeVersion
          ? runtimeVersion
          : undefined,
      templateId: templateId || undefined,
      createDnsZone: Boolean(domain && createDns),
      createMailDomain: Boolean(domain && createMail),
      serverIp: createDns || createMail ? serverIp : undefined,
      serverIpv6:
        createDns || createMail
          ? serverIpv6.trim() || undefined
          : undefined,
    });
  }

  const hasDomain = Boolean(domain.trim());

  const filteredTemplates = useMemo(() => {
    return [...templates].sort((a, b) => {
      const aMatch = a.runtime === runtime ? 0 : 1;
      const bMatch = b.runtime === runtime ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [templates, runtime]);

  const selectedTpl = templates.find((x) => x.id === templateId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('projects.create')}
      description={t('projects.createHint')}
      size="lg"
      footer={
        <ActionBar size="md" align="end">
          <Button
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            form="project-create-form"
            loading={busy}
            disabled={!name.trim()}
          >
            {t('projects.create')}
          </Button>
        </ActionBar>
      }
    >
      <form
        id="project-create-form"
        className="project-create-form"
        onSubmit={(e) => void handleSubmit(e)}
      >
        {/* ① 基本：單欄，避免 SegRadio 把兩欄撐歪 */}
        <FormLayout>
          <Field label="專案名稱" htmlFor="pname" required flush>
            <input
              id="pname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="my-app"
            />
          </Field>
          <Field
            label="執行環境"
            htmlFor="pruntime"
            hint="之後可在詳情調整部署方式"
            flush
          >
            <SegRadio
              name="pruntime"
              aria-label="執行環境"
              value={runtime}
              onChange={(next) => applyRuntime(next as typeof runtime)}
              options={[
                { value: 'node', label: 'Node' },
                { value: 'php', label: 'PHP' },
                { value: 'python', label: 'Python' },
                { value: 'go', label: 'Go' },
                { value: 'rust', label: 'Rust' },
                { value: 'static', label: '靜態' },
              ]}
            />
          </Field>
          {versionChoices.length > 0 ? (
            <Field
              label="版本"
              htmlFor="pver"
              flush
              required
              hint="寫入專案 runtime_version；部署／FPM 會參考此版本"
            >
              <SegRadio
                name="pver"
                aria-label="執行環境版本"
                value={
                  versionChoices.includes(runtimeVersion)
                    ? runtimeVersion
                    : versionChoices[0]!
                }
                onChange={setRuntimeVersion}
                options={versionChoices.map((v) => ({
                  value: v,
                  label:
                    runtime === 'node' && v === '20'
                      ? '20 LTS'
                      : runtime === 'rust' && v === 'stable'
                        ? 'stable'
                        : v,
                }))}
              />
            </Field>
          ) : null}
        </FormLayout>

        {/* ② 域名：兩欄對齊 */}
        <FormLayout columns={2}>
          <Field label="主要域名" htmlFor="pdomain" hint="可稍後再填" flush>
            <input
              id="pdomain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="app.example.com"
            />
          </Field>
          <Field label="別名" htmlFor="paliases" hint="逗號或換行分隔" flush>
            <input
              id="paliases"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="www.example.com"
            />
          </Field>
        </FormLayout>

        {/* ③ 範本 */}
        <FormLayout>
          <Field
            label="範本"
            htmlFor="ptpl"
            flush
            hint="選範本會自動帶入對應執行環境"
          >
            <select
              id="ptpl"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                const tpl = templates.find((x) => x.id === e.target.value);
                if (
                  tpl?.runtime === 'node' ||
                  tpl?.runtime === 'php' ||
                  tpl?.runtime === 'static' ||
                  tpl?.runtime === 'python' ||
                  tpl?.runtime === 'go' ||
                  tpl?.runtime === 'rust'
                ) {
                  applyRuntime(tpl.runtime);
                }
              }}
            >
              <option value="">{t('projects.templateNone')}</option>
              {filteredTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                  {tpl.runtime === runtime
                    ? ''
                    : `（${formatRuntimeName(tpl.runtime)}）`}
                </option>
              ))}
            </select>
          </Field>
        </FormLayout>

        {selectedTpl ? (
          <div className="project-create-form__tpl">
            <ActionBar size="sm" className="u-mb-2">
              <strong>{selectedTpl.name}</strong>
              <Badge tone="info">
                {formatRuntimeName(selectedTpl.runtime)}
              </Badge>
            </ActionBar>
            <p className="muted u-text-sm u-mb-0">{selectedTpl.description}</p>
            <p className="muted u-text-sm u-mt-2 u-mb-0">
              範本只寫入專案目錄骨架；需再「部署」才會 build／啟動。
            </p>
          </div>
        ) : (
          <FormHint>
            目前執行環境：
            <strong>{formatRuntimeName(runtime)}</strong>
            。可選範本加速起步，或不選直接空白專案。
          </FormHint>
        )}

        {/* ④ 草稿資源 — 永遠顯示（唔再因未填域名而消失） */}
        <div className="project-create-form__extras">
          <p className="project-create-form__extras-title">
            與域名一併建立草稿資源
          </p>
          {!hasDomain ? (
            <FormHint>
              請先填「主要域名」，以下選項才會一併建立草稿。
            </FormHint>
          ) : null}
          <div className="form-switches">
            <CheckboxField
              id="pc-dns"
              label="同時建立 DNS zone"
              description="只寫管理檔（draft），唔等於權威 DNS 已上線"
              checked={createDns && hasDomain}
              onChange={(v) => setCreateDns(v)}
              disabled={!hasDomain || busy}
            />
            <CheckboxField
              id="pc-mail"
              label="同時登記郵件域名"
              description="之後可到郵件頁完成郵箱與套用"
              checked={createMail && hasDomain}
              onChange={(v) => setCreateMail(v)}
              disabled={!hasDomain || busy}
            />
          </div>
          {hasDomain && (createDns || createMail) ? (
            <FormLayout columns={2}>
              <Field
                label="伺服器 IPv4"
                htmlFor="pc-ip"
                flush
                hint="DNS／郵件範本用"
              >
                <input
                  id="pc-ip"
                  value={serverIp}
                  onChange={(e) => setServerIp(e.target.value)}
                  placeholder="此主機公網 IPv4"
                />
              </Field>
              <Field label="伺服器 IPv6（可選）" htmlFor="pc-ip6" flush>
                <input
                  id="pc-ip6"
                  value={serverIpv6}
                  onChange={(e) => setServerIpv6(e.target.value)}
                  placeholder="公網 IPv6（可留空）"
                />
              </Field>
            </FormLayout>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

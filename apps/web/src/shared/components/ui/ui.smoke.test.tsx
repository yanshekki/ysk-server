import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  buttonClassName,
  Card,
  CardHeader,
  CardSection,
  CheckboxField,
  CodeBlock,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  FeatureIconGrid,
  FeaturePageLayout,
  Field,
  Form,
  FormActions,
  FormLayout,
  InfoCard,
  InfoCardGrid,
  KpiCard,
  KpiGrid,
  ListPanel,
  ListToolbar,
  LoadingBlock,
  LogViewer,
  Modal,
  MultiCheckSelect,
  OpsResultPanel,
  PageGuide,
  PageHeader,
  PageStatusBar,
  PageTabs,
  PresetChips,
  PromptDialog,
  SegRadio,
  ServerListFilters,
  SplitPanel,
  StructuredFacts,
  SummaryStrip,
  WithPageGuide } from './index';

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('UI primitives smoke', () => {
  it('Button variants + loading + buttonClassName', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="primary" onClick={onClick}>
        Save
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('btn--primary');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(
      <Button loading variant="danger">
        Go
      </Button>,
    );
    expect(screen.getByRole('button')).toBeDisabled();
    expect(buttonClassName({ variant: 'ghost', fullWidth: true })).toContain('btn--ghost');
    expect(buttonClassName({ variant: 'ghost', fullWidth: true })).toContain('btn--block');
    rerender(
      <Button variant="link" size="sm">
        Linky
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Linky' })).toBeInTheDocument();
  });

  it('Badge / Alert / EmptyState / LoadingBlock / PageHeader', () => {
    render(
      <>
        <Badge tone="ok">OK</Badge>
        <Alert variant="error">Boom</Alert>
        <Alert variant="ok">Fine</Alert>
        <EmptyState title="Nothing here" description="yet" />
        <LoadingBlock label="Please wait" />
        <PageHeader title="Page" subtitle="sub" actions={<span>act</span>} />
      </>,
    );
    expect(screen.getByText('OK')).toHaveClass('badge--ok');
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Please wait')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Page' })).toBeInTheDocument();
  });

  it('Card + Field + Form + FormActions + CheckboxField', async () => {
    const user = userEvent.setup();
    const onCheck = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <Card>
        <CardHeader title="Card title" description="desc" />
        <CardSection title="Section">
          <Form onSubmit={onSubmit}>
            <FormLayout>
              <Field label="Name" htmlFor="name" required error="required">
                <input id="name" />
              </Field>
              <CheckboxField
                id="c1"
                label="Agree"
                checked={false}
                onChange={onCheck}
              />
            </FormLayout>
            <FormActions>
              <Button type="submit">Submit</Button>
            </FormActions>
          </Form>
        </CardSection>
      </Card>,
    );
    expect(screen.getByText('Card title')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('required');
    await user.click(screen.getByLabelText('Agree'));
    expect(onCheck).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('ActionBar / SummaryStrip / StructuredFacts / DescriptionList / Kpi', () => {
    render(
      <>
        <ActionBar aria-label="ops">
          <Button>A</Button>
        </ActionBar>
        <SummaryStrip items={[{ label: 'CPU', value: '10%', tone: 'ok' }]} />
        <StructuredFacts
          items={[{ label: 'Port', value: '80', tone: 'info' }]}
        />
        <DescriptionList items={[{ label: 'Host', value: 'a.example' }]} />
        <KpiGrid cols={2}>
          <KpiCard label="Sites" badge={{ label: 'live', tone: 'ok' }}>
            3
          </KpiCard>
        </KpiGrid>
      </>,
    );
    expect(screen.getByRole('group', { name: 'ops' })).toBeInTheDocument();
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('Port')).toBeInTheDocument();
    expect(screen.getByText('a.example')).toBeInTheDocument();
    expect(screen.getByText('Sites')).toBeInTheDocument();
  });

  it('DataTable rows + empty', () => {
    const { rerender } = render(
      <DataTable
        title="Items"
        columns={[
          { key: 'n', header: 'Name', render: (r: { name: string }) => r.name },
        ]}
        rows={[{ name: 'alpha' }]}
        rowKey={(r) => r.name}
        rowActions={() => <Button size="sm">Edit</Button>}
      />,
    );
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();

    rerender(
      <DataTable
        title="Items"
        columns={[{ key: 'n', header: 'Name', render: () => null }]}
        rows={[]}
        rowKey={(_, i) => String(i)}
        empty={<EmptyState title="No rows" />}
      />,
    );
    expect(screen.getByText('No rows')).toBeInTheDocument();
  });

  it('ListPanel / ListToolbar / ServerListFilters / InfoCard', async () => {
    const user = userEvent.setup();
    const setQ = vi.fn();
    const clear = vi.fn();
    render(
      <>
        <ListPanel title="List" toolbar={<Button>New</Button>} empty emptyTitle="Empty list">
          <div>hidden</div>
        </ListPanel>
        <ListToolbar
          search="q"
          onSearchChange={setQ}
          total={2}
          activeFilterCount={1}
          onClear={clear}
          chipGroups={[
            {
              key: 'role',
              allLabel: 'All',
              value: 'admin',
              onChange: vi.fn(),
              chips: [{ id: 'admin', label: 'Admin', count: 1 }] },
          ]}
        />
        <ServerListFilters
          q=""
          setQ={setQ}
          clear={clear}
          activeFilterCount={0}
          total={0}
        />
        <InfoCardGrid cols={2}>
          <InfoCard
            title="Node"
            badge={{ label: 'ok', tone: 'ok' }}
            facts={[{ label: 'path', value: '/usr/bin/node', mono: true }]}
          />
        </InfoCardGrid>
      </>,
    );
    expect(screen.getByText('Empty list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
    expect(screen.getByText('/usr/bin/node')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(clear).toHaveBeenCalled();
  });

  it('Modal / ConfirmDialog / PromptDialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const onSubmit = vi.fn();
    const modal = render(
      <Modal open title="Dlg" onClose={onClose} footer={<Button>OK</Button>}>
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Dlg' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    modal.unmount();

    const confirm = render(
      <ConfirmDialog
        open
        title="Sure?"
        description="Really"
        onClose={onClose}
        onConfirm={onConfirm}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        danger
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalled();
    confirm.unmount();

    render(
      <PromptDialog
        open
        title="Enter code"
        label="Code"
        onClose={onClose}
        onSubmit={onSubmit}
        defaultValue="x"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
      />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('x');
    expect(screen.getByText('Code', { selector: 'label' })).toBeInTheDocument();
  });

  it('PageTabs / SegRadio / PresetChips / MultiCheckSelect', async () => {
    const user = userEvent.setup();
    const onTab = vi.fn();
    const onSeg = vi.fn();
    const onPreset = vi.fn();
    const onMulti = vi.fn();
    render(
      <>
        <PageTabs
          tabs={[
            { id: 'a', label: 'Tab A' },
            { id: 'b', label: 'Tab B', badge: 2 },
          ]}
          active="a"
          onChange={onTab}
        >
          <div>panel-a</div>
        </PageTabs>
        <SegRadio
          name="size"
          value="sm"
          onChange={onSeg}
          options={[
            { value: 'sm', label: 'Small' },
            { value: 'lg', label: 'Large' },
          ]}
        />
        <PresetChips
          options={[
            { value: '1h', label: '1 hour' },
            { value: '1d', label: '1 day' },
          ]}
          value="1h"
          onChange={onPreset}
          allowCustom
        />
        <MultiCheckSelect
          id="mcs"
          options={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
          ]}
          value={['a']}
          onChange={onMulti}
        />
      </>,
    );
    expect(screen.getByText('panel-a')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Tab B/i }));
    expect(onTab).toHaveBeenCalledWith('b');
    await user.click(screen.getByLabelText('Large'));
    expect(onSeg).toHaveBeenCalledWith('lg');
    await user.click(screen.getByRole('button', { name: '1 day' }));
    expect(onPreset).toHaveBeenCalledWith('1d');
    expect(screen.getAllByText('Alpha').length).toBeGreaterThanOrEqual(1);
  });

  it('CodeBlock / LogViewer / SplitPanel / PageStatusBar / FeaturePageLayout', () => {
    wrap(
      <>
        <CodeBlock>{'echo hi'}</CodeBlock>
        <LogViewer text={'ERROR boom\ninfo ok\n203.0.113.10 connected'} />
        <SplitPanel left={<span>L</span>} right={<span>R</span>} leftTitle="Left" rightTitle="Right" />
        <PageStatusBar
          pill={{ label: 'Ready', tone: 'ok' }}
          chips={[{ label: 'Jobs', value: 3, tone: 'info' }]}
        />
        <FeaturePageLayout
          title="Feature"
          backTo="/"
          status={{
            pill: { label: 'Live', tone: 'ok' },
            items: [{ label: 'Count', value: 1 }] }}
        >
          <p>body-content</p>
        </FeaturePageLayout>
      </>,
    );
    expect(screen.getByText('echo hi')).toBeInTheDocument();
    expect(screen.getByText(/ERROR boom/)).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Feature' })).toBeInTheDocument();
    expect(screen.getByText('body-content')).toBeInTheDocument();
  });

  it('FeatureIconGrid + PageGuide + WithPageGuide', () => {
    wrap(
      <>
        <FeatureIconGrid
          items={[
            {
              to: '/projects',
              key: 'projects',
              icon: '▣',
              title: 'Projects',
              description: 'Sites',
              badge: { label: 'new', tone: 'info' } },
          ]}
        />
        <PageGuide
          doc={{
            id: 'test',
            title: 'Guide Title',
            summary: 'Summary text',
            canDo: ['Do F1'],
            notes: ['c1'],
            features: [{ name: 'F1', purpose: 'does things' }],
            useCases: ['uc1'],
            workflow: ['w1'],
            caveats: ['c1'] }}
        />
        <WithPageGuide guideId="__missing__" mainLabel="Main">
          <span>main-body</span>
        </WithPageGuide>
      </>,
    );
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Guide Title')).toBeInTheDocument();
    expect(screen.getByText('main-body')).toBeInTheDocument();
  });

  it('OpsResultPanel: requiresExecute honesty is not bare Success', () => {
    render(
      <OpsResultPanel
        title="Apply result"
        result={{
          ok: true,
          apply_status: 'written',
          requiresExecute: true,
          notes: ['written ≠ applied'],
          blockMessage: 'Host execute is off' }}
      />,
    );
    // Blocked honesty banner
    expect(screen.getByText(/cannot run/i)).toBeInTheDocument();
    // Must not show only Success for blocked-but-ok honesty
    const successBadges = screen.queryAllByText(/^Success$/);
    expect(successBadges.length).toBe(0);
    expect(screen.getByText('Apply result')).toBeInTheDocument();
  });

  it('OpsResultPanel: plain success still shows Success', () => {
    render(
      <OpsResultPanel
        result={{ ok: true, notes: ['Certificate issued'] }}
        message="Done"
      />,
    );
    expect(screen.getByText(/^Success$/)).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('OpsResultPanel: collapses technical notes behind Details toggle', () => {
    render(
      <OpsResultPanel
        result={{
          ok: true,
          processStatus: 'running',
          port: 3201,
          notes: [
            '建置完成',
            '健康檢查通過（4ms）',
            'systemd: is-active=inactive, MainPID=0 journalctl -u foo',
            'export CARGO_HOME=/usr/local/ysk/rust/cargo cargo build --release',
          ] }}
      />,
    );
    expect(screen.getByText(/^Success$/)).toBeInTheDocument();
    // Primary human lines visible
    expect(screen.getByText(/建置完成|Build completed/i)).toBeInTheDocument();
    // Raw cargo export not dumped as open list item
    expect(screen.queryByText(/export CARGO_HOME=\/usr\/local/i)).not.toBeInTheDocument();
  });

  it('OpsResultPanel null when empty', () => {
    const { container } = render(<OpsResultPanel result={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

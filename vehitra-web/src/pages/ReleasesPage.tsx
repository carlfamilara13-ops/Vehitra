import { useMemo, useState } from 'react';
import { CheckCircle2, GitBranch, History, Inbox, Rocket, ShieldCheck, Wrench } from 'lucide-react';
import type { AdminMember, ModelView, Workspace } from '../types';
import { canWriteCatalog, modelVersionSummary } from '../lib/derive';
import { adminApi } from '../lib/api';
import { formatDateTime, formatNumber, modelLabel, pluralize, relativeTime } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ModelStatusBadge,
  Notice,
  PageHeader,
  ReviewBadge,
  SectionHeader,
  StatCard,
} from '../components/ui';

type RunAction = (label: string, action: () => Promise<unknown>) => Promise<boolean>;
type SummaryRow = ReturnType<typeof modelVersionSummary>[number];

export function ReleasesPage({
  workspace,
  views,
  member,
  runAction,
  openRules,
}: {
  workspace: Workspace;
  views: ModelView[];
  member: AdminMember;
  runAction: RunAction;
  openRules: (modelId: string) => void;
}) {
  const [publishTarget, setPublishTarget] = useState<SummaryRow | null>(null);
  const [publishAll, setPublishAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const canWrite = canWriteCatalog(member.role);
  const summary = useMemo(() => modelVersionSummary(views, workspace), [views, workspace]);
  const drafts = summary.filter((row) => !row.published);
  const published = summary.filter((row) => row.published);
  const unreviewedDraftRules = drafts.reduce((sum, row) => sum + row.draft_count, 0);
  const draftViews = views.filter((view) => view.draft);

  const publishOne = async () => {
    if (!publishTarget) return;
    setBusy(true);
    const ok = await runAction(`v${publishTarget.version} published`, () =>
      adminApi.publishVersion(publishTarget.model_id, publishTarget.version),
    );
    setBusy(false);
    if (ok) setPublishTarget(null);
  };

  const publishEverything = async () => {
    setBusy(true);
    const ok = await runAction('All draft versions published', async () => {
      for (const row of drafts) {
        if (row.rule_count === 0) throw new Error(`${row.model ? modelLabel(row.model) : row.model_id} has no rules and cannot be published.`);
        await adminApi.publishVersion(row.model_id, row.version);
      }
    });
    setBusy(false);
    if (ok) setPublishAll(false);
  };

  return (
    <>
      <PageHeader
        eyebrow="Catalog releases"
        title="Ship a version. Keep history intact."
        description="Publishing makes a version current for future mobile downloads. It never silently rewrites the catalog snapshot attached to an existing vehicle."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<GitBranch size={15} />}
              onClick={() => draftViews[0] && openRules(draftViews[0].model.id)}
              disabled={!draftViews.length}
            >
              Open a draft
            </Button>
            <Button
              variant="primary"
              icon={<Rocket size={16} />}
              onClick={() => setPublishAll(true)}
              disabled={!canWrite || !drafts.length}
              title={!canWrite ? 'Publishing requires a catalog or super admin role' : undefined}
            >
              Publish all drafts
            </Button>
          </>
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Open draft versions" value={formatNumber(drafts.length)} hint={`${draftViews.length} models affected`} icon={GitBranch} tone={drafts.length ? 'warning' : 'success'} />
        <StatCard label="Unreviewed in drafts" value={formatNumber(unreviewedDraftRules)} hint="Can still be published" icon={Wrench} tone={unreviewedDraftRules ? 'warning' : 'success'} />
        <StatCard label="Published versions" value={formatNumber(published.length)} hint="Immutable history" icon={ShieldCheck} tone="success" />
        <StatCard label="Catalog rules" value={formatNumber(workspace.rules.length)} hint="Across all versions" icon={History} tone="neutral" />
      </div>

      <Notice tone="info" title="How publishing works">
        A published version becomes the current version for new downloads and for the remote catalog index. Existing vehicles keep
        their previous snapshot until the owner accepts an update in the mobile app. Published numbers are frozen forever.
      </Notice>

      <SectionHeader title="Draft releases" description="Publish each draft after checking its rules and source notes." />

      {drafts.length ? (
        <div className="release-list">
          {drafts.map((row) => (
            <Card key={`${row.model_id}-${row.version}`} className="release-card">
              <div className="release-main">
                <div className="release-icon" aria-hidden>
                  <GitBranch size={18} />
                </div>
                <div className="release-copy">
                  <div className="release-title">
                    <h3>{row.model ? modelLabel(row.model) : row.model_id}</h3>
                    <Badge tone="warning">Draft v{row.version}</Badge>
                    {row.rule_count === 0 && <Badge tone="danger">No rules</Badge>}
                  </div>
                  <p>
                    {row.model?.type.name ?? 'Vehicle'} · {pluralize(row.rule_count, 'rule')} · {pluralize(row.draft_count, 'unreviewed rule')} · created{' '}
                    {relativeTime(row.created_at)}
                  </p>
                  {row.note && <p className="release-note">{row.note}</p>}
                </div>
              </div>
              <div className="release-actions">
                <Button variant="secondary" size="sm" icon={<Wrench size={14} />} onClick={() => openRules(row.model_id)}>
                  Review rules
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Rocket size={14} />}
                  onClick={() => setPublishTarget(row)}
                  disabled={!canWrite || row.rule_count === 0}
                  title={
                    !canWrite
                      ? 'Publishing requires a catalog or super admin role'
                      : row.rule_count === 0
                        ? 'Add at least one rule before publishing'
                        : undefined
                  }
                >
                  Publish v{row.version}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title="No draft releases"
            description="Every active catalog version is published. Start a revision from Maintenance rules when intervals need to change."
            action={
              draftViews[0] ? (
                <Button variant="secondary" onClick={() => openRules(draftViews[0].model.id)}>
                  Open maintenance rules
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      <SectionHeader title="Version history" description="Published versions are immutable and remain available to existing snapshots." />

      {published.length ? (
        <Card className="table-card">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Version</th>
                  <th>Rules</th>
                  <th>Unreviewed</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="align-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {published.slice(0, 60).map((row) => (
                  <tr key={`${row.model_id}-${row.version}`}>
                    <td>
                      <div className="table-primary">
                        <strong>{row.model ? modelLabel(row.model) : row.model_id}</strong>
                        <span>{row.model?.type.name ?? 'Vehicle'}</span>
                      </div>
                    </td>
                    <td>
                      <span className="mono">v{row.version}</span>
                    </td>
                    <td>{formatNumber(row.rule_count)}</td>
                    <td>{formatNumber(row.draft_count)}</td>
                    <td>
                      <ModelStatusBadge status={row.model?.active === false ? 'archived' : 'published'} />
                    </td>
                    <td>
                      <span title={formatDateTime(row.created_at)}>{relativeTime(row.created_at)}</span>
                    </td>
                    <td className="align-right">
                      <Button variant="ghost" size="sm" onClick={() => openRules(row.model_id)}>
                        View rules
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState icon={Inbox} title="No published versions yet" description="Create a model, add rules, and publish its first version." />
        </Card>
      )}

      <Card className="release-footnote">
        <ReviewBadge status="reviewed" />
        <p>
          Review status travels with the version. Publishing a draft with unreviewed rules is allowed, but those rules remain
          labelled as unreviewed in the mobile app.
        </p>
      </Card>

      <ConfirmDialog
        open={Boolean(publishTarget)}
        title={publishTarget ? `Publish v${publishTarget.version}?` : 'Publish version?'}
        description={publishTarget?.model ? modelLabel(publishTarget.model) : undefined}
        confirmLabel="Publish version"
        busy={busy}
        onClose={() => setPublishTarget(null)}
        onConfirm={publishOne}
      >
        <p className="muted">
          {publishTarget
            ? `${publishTarget.rule_count} rules will become the current catalog version. ${publishTarget.draft_count} are still unreviewed. This action is immutable.`
            : 'This action is immutable.'}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={publishAll}
        title={`Publish ${pluralize(drafts.length, 'draft version')}?`}
        description="Every draft with at least one rule will be published in sequence."
        confirmLabel="Publish all"
        busy={busy}
        onClose={() => setPublishAll(false)}
        onConfirm={publishEverything}
      >
        <p className="muted">
          {pluralize(drafts.length, 'version')} will become current immediately. Any draft without rules will stop the batch and
          report an error. Publishing is immutable.
        </p>
      </ConfirmDialog>
    </>
  );
}

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Car,
  CheckCircle2,
  GitBranch,
  Inbox,
  ShieldCheck,
  Wrench,
  Users,
} from 'lucide-react';
import type { AdminMember, ModelView, PageId, Workspace } from '../types';
import { VEHICLE_TYPES } from '../types';
import { buildRequestGroups, modelVersionSummary, workspaceCounts } from '../lib/derive';
import {
  auditActionLabel,
  auditTargetLabel,
  formatDateTime,
  formatNumber,
  modelLabel,
  pluralize,
  relativeTime,
} from '../lib/format';
import { Badge, Card, EmptyState, PageHeader, Progress, SectionHeader, StatCard } from '../components/ui';

export function OverviewPage({
  workspace,
  views,
  member,
  onNavigate,
}: {
  workspace: Workspace;
  views: ModelView[];
  member: AdminMember;
  onNavigate: (page: PageId) => void;
}) {
  const counts = workspaceCounts(workspace, views);
  const requestGroups = buildRequestGroups(workspace.requests);
  const reviewRate = workspace.rules.length
    ? Math.round((counts.reviewedRules / workspace.rules.length) * 100)
    : 0;
  const typeCounts = VEHICLE_TYPES.map((type) => ({
    ...type,
    count: views.filter((view) => view.model.type.code === type.code && view.model.active).length,
  })).filter((type) => type.count > 0);
  const versionSummary = modelVersionSummary(views, workspace).slice(0, 5);
  const recentAudit = workspace.audit.slice(0, 5);

  const attention = [
    counts.openDrafts
      ? {
          icon: GitBranch,
          tone: 'warning' as const,
          title: pluralize(counts.openDrafts, 'draft release') + ' waiting',
          copy: 'Mobile keeps the old snapshot until you publish a new version.',
          page: 'releases' as PageId,
        }
      : null,
    counts.draftRules
      ? {
          icon: AlertTriangle,
          tone: 'warning' as const,
          title: pluralize(counts.draftRules, 'unreviewed rule'),
          copy: 'Intervals without a named reviewer stay clearly labelled in the app.',
          page: 'rules' as PageId,
        }
      : null,
    counts.newRequests
      ? {
          icon: Inbox,
          tone: 'info' as const,
          title: pluralize(counts.newRequests, 'new model request'),
          copy: 'Group demand before deciding whether to add a catalog model.',
          page: 'requests' as PageId,
        }
      : null,
    workspace.admins.some((admin) => admin.status === 'suspended')
      ? {
          icon: Users,
          tone: 'neutral' as const,
          title: 'Suspended administrator',
          copy: 'Review access before that person needs the console again.',
          page: 'admins' as PageId,
        }
      : null,
  ].filter(Boolean) as {
    icon: typeof GitBranch;
    tone: 'warning' | 'info' | 'neutral';
    title: string;
    copy: string;
    page: PageId;
  }[];

  return (
    <>
      <PageHeader
        eyebrow={`Signed in as ${member.display_name}`}
        title="Catalog operations, without guesswork."
        description="Track the state of every vehicle model, keep unreviewed maintenance data honest, and publish immutable releases the mobile app can trust."
        actions={
          <>
            <button type="button" className="link-btn" onClick={() => onNavigate('health')}>
              <Activity size={15} /> System health
            </button>
            <button type="button" className="btn btn-primary btn-md" onClick={() => onNavigate('catalog')}>
              <Car size={16} /> <span>Open catalog</span>
            </button>
          </>
        }
      />

      <section className="overview-hero" aria-labelledby="catalog-readiness">
        <div className="overview-hero-copy">
          <Badge tone={counts.openDrafts ? 'warning' : 'success'} dot>
            {counts.openDrafts ? `${counts.openDrafts} draft release${counts.openDrafts === 1 ? '' : 's'} open` : 'No open drafts'}
          </Badge>
          <h2 id="catalog-readiness">Catalog review coverage</h2>
          <p>
            {formatNumber(counts.reviewedRules)} of {formatNumber(workspace.rules.length)} maintenance rules have a named
            reviewer. Unreviewed values remain visible but are never presented as manufacturer recommendations.
          </p>
          <Progress value={reviewRate} label="Rules with a named reviewer" />
          <div className="hero-actions">
            <button type="button" className="link-btn" onClick={() => onNavigate('rules')}>
              Review maintenance data <ArrowRight size={14} />
            </button>
            <button type="button" className="link-btn" onClick={() => onNavigate('releases')}>
              Prepare a release <ArrowRight size={14} />
            </button>
          </div>
        </div>
        <div className="overview-hero-stats" aria-label="Workspace summary">
          <div>
            <span>Active models</span>
            <strong>{formatNumber(counts.total - counts.archived)}</strong>
          </div>
          <div>
            <span>Published</span>
            <strong>{formatNumber(counts.published)}</strong>
          </div>
          <div>
            <span>Open request groups</span>
            <strong>{formatNumber(requestGroups.filter((group) => group.status === 'new').length)}</strong>
          </div>
        </div>
      </section>

      <div className="stat-grid">
        <StatCard label="Vehicle models" value={formatNumber(counts.total)} hint={`${counts.archived} archived`} icon={Car} tone="accent" />
        <StatCard label="Maintenance rules" value={formatNumber(workspace.rules.length)} hint={`${counts.draftRules} unreviewed`} icon={Wrench} tone="info" />
        <StatCard label="Open drafts" value={formatNumber(counts.openDrafts)} hint="Awaiting publish" icon={GitBranch} tone={counts.openDrafts ? 'warning' : 'success'} />
        <StatCard label="New requests" value={formatNumber(counts.newRequests)} hint={`${requestGroups.length} grouped requests`} icon={Inbox} tone={counts.newRequests ? 'warning' : 'success'} />
        <StatCard label="Review coverage" value={`${reviewRate}%`} hint={`${counts.reviewedRules} reviewed`} icon={CheckCircle2} tone="success" />
        <StatCard label="Active admins" value={formatNumber(counts.activeAdmins)} hint="Role-enforced access" icon={ShieldCheck} tone="neutral" />
      </div>

      <div className="dashboard-grid">
        <Card className="panel">
          <SectionHeader
            title="Catalog mix"
            description="Active models by vehicle type."
            actions={
              <button type="button" className="link-btn" onClick={() => onNavigate('catalog')}>
                View catalog <ArrowRight size={14} />
              </button>
            }
          />
          {typeCounts.length ? (
            <div className="bar-list">
              {typeCounts.map((type) => (
                <div key={type.code} className="bar-row">
                  <div className="bar-meta">
                    <span>{type.label}</span>
                    <strong>{type.count}</strong>
                  </div>
                  <div className="bar-track" aria-hidden>
                    <span style={{ width: `${Math.max(6, (type.count / Math.max(...typeCounts.map((item) => item.count))) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No active models yet.</p>
          )}
          <div className="panel-foot">
            <span>{counts.published} published</span>
            <span>{counts.draft} draft</span>
            <span>{counts.archived} archived</span>
          </div>
        </Card>

        <Card className="panel">
          <SectionHeader title="Needs attention" description="The next decisions worth making." />
          {attention.length ? (
            <div className="attention-list">
              {attention.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.title} type="button" className="attention-item" onClick={() => onNavigate(item.page)}>
                    <span className={`attention-icon attention-${item.tone}`} aria-hidden>
                      <Icon size={17} />
                    </span>
                    <span className="attention-copy">
                      <strong>{item.title}</strong>
                      <span>{item.copy}</span>
                    </span>
                    <ArrowRight size={15} aria-hidden />
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} title="Nothing urgent" description="Drafts are clear and every request has been triaged." />
          )}
        </Card>
      </div>

      <div className="dashboard-grid">
        <Card className="panel">
          <SectionHeader
            title="Release pipeline"
            description="Newest catalog versions across all models."
            actions={
              <button type="button" className="link-btn" onClick={() => onNavigate('releases')}>
                All releases <ArrowRight size={14} />
              </button>
            }
          />
          {versionSummary.length ? (
            <div className="mini-list">
              {versionSummary.map((version) => (
                <div key={`${version.model_id}-${version.version}`} className="mini-row">
                  <span className={`mini-dot ${version.published ? 'published' : 'draft'}`} aria-hidden />
                  <div className="mini-copy">
                    <strong>{version.model ? modelLabel(version.model) : version.model_id}</strong>
                    <span>
                      v{version.version} · {version.rule_count} rules · {version.draft_count} unreviewed
                    </span>
                  </div>
                  <Badge tone={version.published ? 'success' : 'warning'}>{version.published ? 'Published' : 'Draft'}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No catalog versions yet.</p>
          )}
        </Card>

        <Card className="panel">
          <SectionHeader
            title="Recent activity"
            description="Append-only audit events."
            actions={
              <button type="button" className="link-btn" onClick={() => onNavigate('audit')}>
                Open audit log <ArrowRight size={14} />
              </button>
            }
          />
          {recentAudit.length ? (
            <div className="activity-list">
              {recentAudit.map((event) => (
                <div key={event.id} className="activity-row">
                  <span className="activity-mark" aria-hidden />
                  <div className="activity-copy">
                    <strong>{auditActionLabel(event.action)}</strong>
                    <span>
                      {auditTargetLabel(event)} · {event.actor_email}
                    </span>
                  </div>
                  <time dateTime={event.created_at} title={formatDateTime(event.created_at)}>
                    {relativeTime(event.created_at)}
                  </time>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No audit events recorded yet.</p>
          )}
        </Card>
      </div>

      <Card className="sync-card">
        <div className="sync-icon" aria-hidden>
          <GitBranch size={20} />
        </div>
        <div>
          <h3>Mobile release behavior</h3>
          <p>
            The app downloads only published versions. Publishing updates the catalog index, but existing vehicles keep their
            original snapshot until the owner explicitly accepts the newer version.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-md" onClick={() => onNavigate('releases')}>
          <span>Manage releases</span>
        </button>
      </Card>

      <p className="page-footnote">
        Reviewer coverage is shown per rule, not per model. {member.role === 'support_admin' ? 'Support admins can triage requests but cannot edit catalog data.' : 'Catalog edits are limited to super and catalog admins.'}
      </p>
    </>
  );
}

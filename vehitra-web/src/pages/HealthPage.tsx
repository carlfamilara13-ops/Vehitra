import { useMemo } from 'react';
import { Activity, Database, GitBranch, Inbox, RefreshCw, ShieldCheck, Smartphone, Users } from 'lucide-react';
import type { AdminMember, Workspace } from '../types';
import { configuredKeyName, isSupabaseConfigured, supabaseProjectHost } from '../supabase';
import { formatDateTime, formatNumber, pluralize, relativeTime, roleLabel, vehicleTypeLabel } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  Notice,
  PageHeader,
  Progress,
  SectionHeader,
  StatCard,
} from '../components/ui';

export function HealthPage({
  workspace,
  member,
  reload,
  loading,
}: {
  workspace: Workspace;
  member: AdminMember;
  reload: () => void;
  loading: boolean;
}) {
  const health = workspace.health;
  const reviewCoverage = health.rules ? Math.round((health.reviewed_rules / health.rules) * 100) : 0;
  const publishedModels = workspace.models.filter((model) => model.active && model.current_version > 0);
  const modelsByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of workspace.models) {
      if (!model.active) continue;
      counts.set(model.type.code, (counts.get(model.type.code) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [workspace.models]);
  const maxTypeCount = Math.max(1, ...modelsByType.map(([, count]) => count));

  const checks = [
    {
      label: 'Database health RPC',
      status: 'pass' as const,
      detail: `Responded for ${health.database_time ? formatDateTime(health.database_time) : 'this snapshot'}.`,
    },
    {
      label: 'Administrator access',
      status: health.admin_members > 0 ? ('pass' as const) : ('fail' as const),
      detail: `${pluralize(health.admin_members, 'active administrator')}.`,
    },
    {
      label: 'Catalog review coverage',
      status: reviewCoverage >= 80 ? ('pass' as const) : reviewCoverage >= 50 ? ('warn' as const) : ('fail' as const),
      detail: `${reviewCoverage}% of all catalog rules are reviewed.`,
    },
    {
      label: 'Open draft versions',
      status: health.draft_versions === 0 ? ('pass' as const) : ('warn' as const),
      detail: health.draft_versions
        ? `${pluralize(health.draft_versions, 'draft version')} not yet visible to mobile.`
        : 'No drafts waiting to be published.',
    },
    {
      label: 'Request queue',
      status: health.open_requests === 0 ? ('pass' as const) : ('warn' as const),
      detail: health.open_requests
        ? `${pluralize(health.open_requests, 'request')} waiting for triage.`
        : 'No untriaged model requests.',
    },
    {
      label: 'Published catalog',
      status: publishedModels.length > 0 ? ('pass' as const) : ('warn' as const),
      detail: `${pluralize(publishedModels.length, 'active model')} with a current version.`,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="System health"
        title="Know what the database sees."
        description="A point-in-time snapshot from the admin health function, plus the workspace loaded into this browser. This is not a live uptime monitor."
        actions={
          <Button variant="secondary" icon={<RefreshCw size={15} className={loading ? 'spin' : undefined} />} onClick={reload} loading={loading}>
            Refresh snapshot
          </Button>
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Active models" value={formatNumber(health.active_models)} hint={`${health.archived_models} archived`} icon={Database} tone="success" />
        <StatCard label="Draft versions" value={formatNumber(health.draft_versions)} hint="Private to admins" icon={GitBranch} tone={health.draft_versions ? 'warning' : 'success'} />
        <StatCard label="Open requests" value={formatNumber(health.open_requests)} hint="Waiting for triage" icon={Inbox} tone={health.open_requests ? 'warning' : 'success'} />
        <StatCard label="Reviewed rules" value={`${reviewCoverage}%`} hint={`${formatNumber(health.reviewed_rules)} of ${formatNumber(health.rules)}`} icon={ShieldCheck} tone={reviewCoverage >= 80 ? 'success' : 'warning'} />
      </div>

      <div className="health-grid">
        <Card className="health-card">
          <div className="health-card-head">
            <div>
              <h2>Workspace connection</h2>
              <p className="muted">Browser session details; no secret key is ever displayed.</p>
            </div>
            <Badge tone={isSupabaseConfigured ? 'success' : 'danger'} dot>
              {isSupabaseConfigured ? 'Connected' : 'Not configured'}
            </Badge>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Supabase project</dt>
              <dd>{supabaseProjectHost ?? 'Not configured'}</dd>
            </div>
            <div>
              <dt>Public key variable</dt>
              <dd>{configuredKeyName ?? 'Missing'}</dd>
            </div>
            <div>
              <dt>Signed in as</dt>
              <dd>{member.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{roleLabel(member.role)}</dd>
            </div>
            <div>
              <dt>Snapshot loaded</dt>
              <dd title={formatDateTime(workspace.loaded_at)}>{relativeTime(workspace.loaded_at)}</dd>
            </div>
            <div>
              <dt>Database time</dt>
              <dd>{formatDateTime(health.database_time)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="health-card">
          <div className="health-card-head">
            <div>
              <h2>Checks</h2>
              <p className="muted">Heuristics for the current snapshot, not an alerting system.</p>
            </div>
            <span className={`health-summary ${checks.some((check) => check.status === 'fail') ? 'bad' : checks.some((check) => check.status === 'warn') ? 'warn' : 'good'}`}>
              {checks.some((check) => check.status === 'fail') ? 'Needs attention' : checks.some((check) => check.status === 'warn') ? 'Review suggested' : 'All clear'}
            </span>
          </div>
          <ul className="health-check-list">
            {checks.map((check) => (
              <li key={check.label}>
                <span className={`check-dot check-${check.status}`} aria-hidden />
                <div>
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
                </div>
                <Badge tone={check.status === 'pass' ? 'success' : check.status === 'warn' ? 'warning' : 'danger'}>
                  {check.status === 'pass' ? 'OK' : check.status === 'warn' ? 'Review' : 'Fail'}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="health-grid">
        <Card className="health-card">
          <div className="health-card-head">
            <div>
              <h2>Catalog mix</h2>
              <p className="muted">Active models by vehicle type.</p>
            </div>
          </div>
          {modelsByType.length ? (
            <div className="bar-list">
              {modelsByType.map(([type, count]) => (
                <div key={type} className="bar-row">
                  <span>{vehicleTypeLabel(type)}</span>
                  <div className="bar-track">
                    <span style={{ width: `${Math.round((count / maxTypeCount) * 100)}%` }} />
                  </div>
                  <strong>{formatNumber(count)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No active models in the catalog.</p>
          )}
        </Card>

        <Card className="health-card">
          <div className="health-card-head">
            <div>
              <h2>Catalog review coverage</h2>
              <p className="muted">Across every version, including immutable published rules.</p>
            </div>
          </div>
          <Progress value={reviewCoverage} label="Reviewed rules" />
          <div className="coverage-split">
            <div>
              <span>Reviewed</span>
              <strong>{formatNumber(health.reviewed_rules)}</strong>
            </div>
            <div>
              <span>Unreviewed</span>
              <strong>{formatNumber(Math.max(0, health.rules - health.reviewed_rules))}</strong>
            </div>
            <div>
              <span>Total rules</span>
              <strong>{formatNumber(health.rules)}</strong>
            </div>
          </div>
          <p className="muted">
            Unreviewed values are allowed. They are labelled clearly in the mobile app so owners can judge the evidence.
          </p>
        </Card>
      </div>

      <SectionHeader title="Operational notes" description="What this screen can and cannot tell you." />
      <div className="health-notes">
        <Card className="help-card">
          <span className="help-icon" aria-hidden>
            <Activity size={17} />
          </span>
          <div>
            <h3>Snapshot, not monitoring</h3>
            <p>Refresh reloads the full workspace and health RPC. There is no background polling or alerting.</p>
          </div>
        </Card>
        <Card className="help-card">
          <span className="help-icon" aria-hidden>
            <Smartphone size={17} />
          </span>
          <div>
            <h3>Mobile catalog is manual</h3>
            <p>Published versions do not push to the mobile app automatically. Remote catalog refresh behavior is configured in the app.</p>
          </div>
        </Card>
        <Card className="help-card">
          <span className="help-icon" aria-hidden>
            <Users size={17} />
          </span>
          <div>
            <h3>Administrator count</h3>
            <p>{pluralize(health.admin_members, 'active administrator')} and {formatNumber(health.audit_events)} audit events recorded.</p>
          </div>
        </Card>
      </div>

      {!isSupabaseConfigured && (
        <Notice tone="danger" title="Supabase environment is incomplete">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in the web app environment. The console
          cannot load live data until both values are present.
        </Notice>
      )}
    </>
  );
}

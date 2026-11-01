import { useState } from 'react';
import { Check, Copy, Database, KeyRound, LogOut, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import type { AdminMember, Workspace } from '../types';
import { configuredKeyName, isSupabaseConfigured, supabaseProjectHost } from '../supabase';
import { formatDateTime, relativeTime, roleLabel } from '../lib/format';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Notice,
  PageHeader,
  RoleBadge,
  SectionHeader,
} from '../components/ui';

const BOOTSTRAP_SQL = `insert into public.admin_members (user_id, email, display_name, role)
select id, lower(email), 'Owner', 'super_admin'
  from auth.users
 where lower(email) = lower('owner@example.com')
on conflict (user_id) do update
  set role = 'super_admin', status = 'active';`;

export function SettingsPage({
  workspace,
  member,
  demo,
  reload,
  loading,
  signOut,
  leaveDemo,
}: {
  workspace: Workspace;
  member: AdminMember;
  demo: boolean;
  reload: () => void;
  loading: boolean;
  signOut: () => void;
  leaveDemo: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const migrationPath = 'supabase/migrations/20261026000100_admin_console.sql';

  const copyBootstrap = async () => {
    try {
      await navigator.clipboard.writeText(BOOTSTRAP_SQL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Configure the console, not the data."
        description="Account, environment, and deployment notes. All catalog writes go through audited database functions instead of direct table grants."
        actions={
          <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={reload} loading={loading}>
            Reload workspace
          </Button>
        }
      />

      {demo && (
        <Notice tone="warning" title="Demo workspace">
          You are viewing clearly labelled sample data. Writes are disabled. Set the Supabase environment variables and restart the
          dev server to use a live project.
          <div className="notice-inline-actions">
            <button type="button" className="link-btn" onClick={leaveDemo}>
              Return to sign-in
            </button>
          </div>
        </Notice>
      )}

      <div className="settings-grid">
        <Card className="settings-card">
          <div className="settings-card-head">
            <div>
              <h2>Account</h2>
              <p className="muted">The signed-in administrator and current session.</p>
            </div>
            <Avatar name={member.display_name || member.email} size="lg" />
          </div>
          <dl className="detail-list">
            <div>
              <dt>Name</dt>
              <dd>{member.display_name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{member.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>
                <RoleBadge role={member.role} />
              </dd>
            </div>
            <div>
              <dt>Account status</dt>
              <dd>
                <Badge tone={member.status === 'active' ? 'success' : 'danger'} dot>
                  {member.status === 'active' ? 'Active' : 'Suspended'}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>Last active</dt>
              <dd title={formatDateTime(member.last_active_at)}>{relativeTime(member.last_active_at)}</dd>
            </div>
            <div>
              <dt>Workspace loaded</dt>
              <dd>{formatDateTime(workspace.loaded_at)}</dd>
            </div>
          </dl>
          <Button
            variant={demo ? 'secondary' : 'ghost'}
            icon={<LogOut size={15} />}
            onClick={demo ? leaveDemo : signOut}
          >
            {demo ? 'Leave demo workspace' : 'Sign out'}
          </Button>
        </Card>

        <Card className="settings-card">
          <div className="settings-card-head">
            <div>
              <h2>Environment</h2>
              <p className="muted">Public client configuration. No secret key belongs in this app.</p>
            </div>
            <span className="settings-icon" aria-hidden>
              <KeyRound size={18} />
            </span>
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
              <dt>Connection</dt>
              <dd>
                <Badge tone={isSupabaseConfigured ? 'success' : 'danger'} dot>
                  {isSupabaseConfigured ? 'Configured' : 'Missing'}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>Admin RPC role</dt>
              <dd>{roleLabel(workspace.health.role)}</dd>
            </div>
            <div>
              <dt>Active administrators</dt>
              <dd>{workspace.health.admin_members.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Audit events</dt>
              <dd>{workspace.health.audit_events.toLocaleString()}</dd>
            </div>
          </dl>
          <Notice tone="info" title="Browser key only">
            Use the Supabase publishable or anon key. Never use a service-role key here; it bypasses Row Level Security.
          </Notice>
        </Card>
      </div>

      <SectionHeader title="First administrator bootstrap" description="Supabase Row Level Security cannot grant the first role by itself." />
      <Card className="settings-card bootstrap-card">
        <div className="bootstrap-copy">
          <div>
            <h3>One manual SQL step</h3>
            <p>
              Apply <code>{migrationPath}</code> first. Have the first administrator sign up or sign in, then run this SQL in the
              Supabase SQL editor with their email. Later admins can be granted from this console.
            </p>
          </div>
          <Badge tone="warning">Required once</Badge>
        </div>
        <div className="code-block">
          <pre>{BOOTSTRAP_SQL}</pre>
          <Button variant="secondary" size="sm" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copyBootstrap}>
            {copied ? 'Copied' : 'Copy SQL'}
          </Button>
        </div>
        <p className="muted">
          The insert only matches existing auth users. It does not create a password or bypass Supabase Auth. Replace the email and
          keep the <code>on conflict</code> clause so rerunning the snippet is safe.
        </p>
      </Card>

      <SectionHeader title="Deployment notes" description="Known configuration that is intentionally not hidden by the console." />
      <div className="settings-notes-grid">
        <Card className="help-card">
          <span className="help-icon" aria-hidden>
            <Database size={17} />
          </span>
          <div>
            <h3>Catalog migrations</h3>
            <p>
              Apply the base migrations, then the admin console migration. The test suite covers RLS, admin roles, audit writes,
              immutable versions, and request triage.
            </p>
          </div>
        </Card>
        <Card className="help-card">
          <span className="help-icon" aria-hidden>
            <ShieldCheck size={17} />
          </span>
          <div>
            <h3>Least privilege</h3>
            <p>
              Support admins can read admin data and triage requests. Catalog writes and role grants are restricted by database
              role checks, not only by hidden buttons.
            </p>
          </div>
        </Card>
        <Card className="help-card">
          <span className="help-icon" aria-hidden>
            <Smartphone size={17} />
          </span>
          <div>
            <h3>Mobile catalog</h3>
            <p>
              The mobile app keeps an offline-first local catalog. Published web versions and the mobile remote catalog refresh are
              separate integration steps; publishing here does not push to a device.
            </p>
          </div>
        </Card>
        <Card className="help-card">
          <span className="help-icon" aria-hidden>
            <KeyRound size={17} />
          </span>
          <div>
            <h3>Vehicle images</h3>
            <p>
              Image upload needs a Supabase Storage bucket and policies. Until those are configured, the catalog text model works
              without images; no upload is attempted.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

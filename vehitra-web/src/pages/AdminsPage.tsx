import { useMemo, useState, type FormEvent } from 'react';
import { Crown, Shield, UserCog, UserPlus, Users } from 'lucide-react';
import type { AdminMember, AdminRole, AdminStatus, Workspace } from '../types';
import { adminApi } from '../lib/api';
import { canManageAdmins } from '../lib/derive';
import { formatDate, pluralize, relativeTime, roleLabel } from '../lib/format';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Notice,
  PageHeader,
  RoleBadge,
  AdminStatusBadge,
  SearchInput,
  Select,
  StatCard,
} from '../components/ui';

type RunAction = (label: string, action: () => Promise<unknown>) => Promise<boolean>;

export function AdminsPage({
  workspace,
  member,
  runAction,
}: {
  workspace: Workspace;
  member: AdminMember;
  runAction: RunAction;
}) {
  const [search, setSearch] = useState('');
  const [grantOpen, setGrantOpen] = useState(false);
  const [editMember, setEditMember] = useState<AdminMember | null>(null);
  const canManage = canManageAdmins(member.role);
  const activeSuperAdmins = workspace.admins.filter((admin) => admin.role === 'super_admin' && admin.status === 'active');
  const counts = {
    active: workspace.admins.filter((admin) => admin.status === 'active').length,
    super: workspace.admins.filter((admin) => admin.role === 'super_admin').length,
    catalog: workspace.admins.filter((admin) => admin.role === 'catalog_admin').length,
    support: workspace.admins.filter((admin) => admin.role === 'support_admin').length,
  };
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return workspace.admins;
    return workspace.admins.filter((admin) =>
      `${admin.display_name} ${admin.email} ${roleLabel(admin.role)}`.toLowerCase().includes(query),
    );
  }, [workspace.admins, search]);

  return (
    <>
      <PageHeader
        eyebrow="Administrators"
        title="Small team. Clear roles."
        description="Super admins manage access. Catalog admins change maintenance data. Support admins triage requests without touching the catalog."
        actions={
          canManage ? (
            <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setGrantOpen(true)}>
              Grant access
            </Button>
          ) : undefined
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Active administrators" value={counts.active.toLocaleString()} hint={`${workspace.admins.length} total`} icon={Users} tone="success" />
        <StatCard label="Super admins" value={counts.super.toLocaleString()} hint={`${activeSuperAdmins.length} active`} icon={Crown} tone="accent" />
        <StatCard label="Catalog admins" value={counts.catalog.toLocaleString()} hint="Can publish versions" icon={Shield} tone="info" />
        <StatCard label="Support admins" value={counts.support.toLocaleString()} hint="Triage only" icon={UserCog} tone="neutral" />
      </div>

      {!canManage && (
        <Notice tone="info" title="Read-only roster">
          Your role can see the administrator roster but cannot grant access or change roles. Ask a super admin for changes.
        </Notice>
      )}

      <Notice tone="warning" title="People must sign up before access is granted">
        Granting access searches existing Supabase accounts by email. The person should sign in once, then a super admin can grant a
        role here. The first super admin must be bootstrapped with the SQL in the README.
      </Notice>

      <Card className="admin-roster">
        <div className="roster-toolbar">
          <div>
            <h2>Team roster</h2>
            <p className="muted">{pluralize(filtered.length, 'administrator')}</p>
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, email, or role…" label="Search administrators" />
        </div>

        {filtered.length ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Administrator</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last active</th>
                  <th>Added</th>
                  <th className="align-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((admin) => {
                  const isSelf = admin.user_id === member.user_id;
                  const isLastSuper =
                    admin.role === 'super_admin' && admin.status === 'active' && activeSuperAdmins.length === 1;
                  return (
                    <tr key={admin.user_id}>
                      <td>
                        <div className="member-cell">
                          <Avatar name={admin.display_name || admin.email} size="sm" />
                          <div className="table-primary">
                            <strong>
                              {admin.display_name}
                              {isSelf && <span className="you-label">You</span>}
                            </strong>
                            <span>{admin.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <RoleBadge role={admin.role} />
                      </td>
                      <td>
                        <AdminStatusBadge status={admin.status} />
                      </td>
                      <td>
                        <span title={admin.last_active_at ?? undefined}>{relativeTime(admin.last_active_at)}</span>
                      </td>
                      <td>{formatDate(admin.created_at)}</td>
                      <td className="align-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditMember(admin)}
                          disabled={!canManage || isSelf || isLastSuper}
                          title={
                            !canManage
                              ? 'Only super admins can change members'
                              : isSelf
                                ? 'You cannot change your own role or status'
                                : isLastSuper
                                  ? 'The last active super admin cannot be demoted or suspended'
                                  : undefined
                          }
                        >
                          Manage
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="No administrators match"
            description="Try a different name, email, or role."
            action={
              <Button variant="secondary" onClick={() => setSearch('')}>
                Clear search
              </Button>
            }
          />
        )}
      </Card>

      <Card className="role-guide">
        <h3>What each role can do</h3>
        <div className="role-guide-grid">
          <div>
            <RoleBadge role="super_admin" />
            <p>Manage administrators, change catalog data, publish versions, triage requests, and read the audit log.</p>
          </div>
          <div>
            <RoleBadge role="catalog_admin" />
            <p>Create and edit models, prepare drafts, review rules, publish versions, and triage requests.</p>
          </div>
          <div>
            <RoleBadge role="support_admin" />
            <p>Read the catalog and audit log, triage model requests, but never edit or publish catalog data.</p>
          </div>
        </div>
      </Card>

      {grantOpen && canManage && (
        <GrantAccessModal
          adminCount={workspace.admins.length}
          runAction={runAction}
          onClose={() => setGrantOpen(false)}
        />
      )}

      {editMember && canManage && (
        <ManageMemberModal
          target={editMember}
          activeSuperAdmins={activeSuperAdmins.length}
          runAction={runAction}
          onClose={() => setEditMember(null)}
        />
      )}
    </>
  );
}

function GrantAccessModal({
  adminCount,
  runAction,
  onClose,
}: {
  adminCount: number;
  runAction: RunAction;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<AdminRole>('support_admin');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError('Enter a valid email address.');
    }
    setBusy(true);
    const ok = await runAction(`${email.trim()} granted ${roleLabel(role).toLowerCase()} access`, () =>
      adminApi.grantRole(email.trim(), displayName.trim(), role),
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Grant administrator access"
      description="The email must already belong to a Supabase account. The person can sign up first, then be granted access."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => document.getElementById('grant-form-submit')?.click()}>
            Grant access
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label="Email" htmlFor="grant-email" hint="Matched case-insensitively against existing accounts.">
          <Input
            id="grant-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
          />
        </Field>
        <Field label="Display name" htmlFor="grant-name" hint="Optional. Defaults to the part before @.">
          <Input
            id="grant-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Full name"
          />
        </Field>
        <Field label="Role" htmlFor="grant-role">
          <Select id="grant-role" value={role} onChange={(event) => setRole(event.target.value as AdminRole)}>
            <option value="support_admin">Support admin — triage only</option>
            <option value="catalog_admin">Catalog admin — edit and publish catalog</option>
            <option value="super_admin">Super admin — full access</option>
          </Select>
        </Field>
        <Notice tone="info" title={`${adminCount} existing administrators`}>
          Granting an existing member a role updates their role and reactivates a suspended account.
        </Notice>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button id="grant-form-submit" type="submit" className="visually-hidden" tabIndex={-1}>
          Submit
        </button>
      </form>
    </Modal>
  );
}

function ManageMemberModal({
  target,
  activeSuperAdmins,
  runAction,
  onClose,
}: {
  target: AdminMember;
  activeSuperAdmins: number;
  runAction: RunAction;
  onClose: () => void;
}) {
  const [role, setRole] = useState<AdminRole>(target.role);
  const [status, setStatus] = useState<AdminStatus>(target.status);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastSuper = target.role === 'super_admin' && target.status === 'active' && activeSuperAdmins === 1;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (lastSuper && (role !== 'super_admin' || status !== 'active')) {
      return setError('At least one active super admin must remain.');
    }
    setBusy(true);
    const ok = await runAction(`${target.display_name} updated`, () =>
      adminApi.updateMember(target.user_id, role, status),
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Manage ${target.display_name}`}
      description={target.email}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => document.getElementById('member-form-submit')?.click()}>
            Save changes
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label="Role" htmlFor="member-role">
          <Select
            id="member-role"
            value={role}
            onChange={(event) => setRole(event.target.value as AdminRole)}
            disabled={lastSuper}
          >
            <option value="support_admin">Support admin — triage only</option>
            <option value="catalog_admin">Catalog admin — edit and publish catalog</option>
            <option value="super_admin">Super admin — full access</option>
          </Select>
        </Field>
        <Field label="Account status" htmlFor="member-status" hint={lastSuper ? 'The last active super admin must stay active.' : undefined}>
          <Select
            id="member-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as AdminStatus)}
            disabled={lastSuper}
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
        </Field>
        <Notice tone="warning" title="Changes take effect immediately">
          Suspending an administrator blocks their next workspace load. Role changes are audited with your account as the actor.
        </Notice>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button id="member-form-submit" type="submit" className="visually-hidden" tabIndex={-1}>
          Submit
        </button>
      </form>
    </Modal>
  );
}

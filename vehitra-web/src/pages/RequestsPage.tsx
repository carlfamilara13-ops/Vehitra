import { useMemo, useState } from 'react';
import { Bike, Bus, Car, Caravan, CheckCircle2, CircleHelp, Inbox, PlusCircle, SearchX, ThumbsDown, ThumbsUp, Truck } from 'lucide-react';
import type { AdminMember, RequestStatus, RequestGroup, Workspace } from '../types';
import { buildRequestGroups, requestCounts } from '../lib/derive';
import { adminApi } from '../lib/api';
import { requestStatusLabel, relativeTime, vehicleTypeLabel } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  RequestBadge,
  SearchInput,
  SectionHeader,
  Segmented,
  StatCard,
} from '../components/ui';

type RunAction = (label: string, action: () => Promise<unknown>) => Promise<boolean>;
type RequestFilter = 'all' | RequestStatus;

export function RequestsPage({
  workspace,
  member,
  runAction,
  openCatalog,
}: {
  workspace: Workspace;
  member: AdminMember;
  runAction: RunAction;
  openCatalog: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<RequestFilter>('new');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const groups = useMemo(() => buildRequestGroups(workspace.requests), [workspace.requests]);
  const counts = requestCounts(groups);

  const filtered = groups.filter((group) => {
    if (statusFilter !== 'all' && group.status !== statusFilter) return false;
    if (typeFilter !== 'all' && group.type !== typeFilter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return `${group.brand ?? ''} ${group.model} ${group.notes ?? ''}`.toLowerCase().includes(query);
  });

  const updateGroup = async (group: RequestGroup, status: RequestStatus) => {
    setBusyGroup(group.key);
    const label =
      status === 'added'
        ? `${group.model} marked added`
        : status === 'rejected'
          ? `${group.model} marked rejected`
          : `${group.model} reopened`;
    await runAction(label, () => adminApi.setRequestStatus(group.ids, status));
    setBusyGroup(null);
  };

  const types = [...new Set(groups.map((group) => group.type))];

  return (
    <>
      <PageHeader
        eyebrow="Model requests"
        title="Listen, then decide."
        description="Requests are grouped by vehicle. Every triage change is audited with your administrator account, so decisions stay accountable."
        actions={
          <Button variant="secondary" icon={<PlusCircle size={15} />} onClick={openCatalog}>
            Add a model
          </Button>
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Requests waiting" value={counts.new.toLocaleString()} hint={`${groups.filter((group) => group.status === 'new').length} distinct vehicles`} icon={Inbox} tone={counts.new ? 'warning' : 'success'} />
        <StatCard label="Marked added" value={counts.added.toLocaleString()} hint="Catalog promise kept" icon={ThumbsUp} tone="success" />
        <StatCard label="Rejected" value={counts.rejected.toLocaleString()} hint="With an audit trail" icon={ThumbsDown} tone="neutral" />
        <StatCard label="All requests" value={counts.all.toLocaleString()} hint={`${counts.groups} vehicle groups`} icon={CheckCircle2} tone="neutral" />
      </div>

      <Notice tone="info" title="Triage with care">
        Only the latest note from each vehicle group is shown. Requests contain user identifiers, so do not copy them into external
        tools. Marking a group updates every matching request in one audited action.
      </Notice>

      <Card className="request-toolbar">
        <Segmented
          label="Filter requests by status"
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as RequestFilter)}
          options={[
            { value: 'new', label: `New (${counts.new})` },
            { value: 'added', label: `Added (${counts.added})` },
            { value: 'rejected', label: `Rejected (${counts.rejected})` },
            { value: 'all', label: `All (${counts.all})` },
          ]}
        />
        <div className="toolbar-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Search brand, model, or note…" label="Search requests" />
          {types.length > 1 && (
            <select
              className="select compact"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              aria-label="Filter by vehicle type"
            >
              <option value="all">All vehicle types</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {vehicleTypeLabel(type)}
                </option>
              ))}
            </select>
          )}
        </div>
      </Card>

      <SectionHeader
        title={statusFilter === 'all' ? 'All vehicle requests' : `${requestStatusLabel(statusFilter)} requests`}
        description={`${filtered.length} groups shown${member.role === 'support_admin' ? ' · support admins can triage but not change the catalog' : ''}`}
      />

      {filtered.length ? (
        <div className="request-list">
          {filtered.map((group) => {
            const busy = busyGroup === group.key;
            const VehicleIcon =
              group.type === 'motorcycle' || group.type === 'bicycle'
                ? Bike
                : group.type === 'car'
                  ? Car
                  : group.type === 'truck'
                    ? Truck
                    : group.type === 'bus'
                      ? Bus
                      : group.type === 'van'
                        ? Caravan
                        : CircleHelp;
            return (
              <Card key={group.key} className="request-card">
                <div className="request-main">
                  <div className="request-icon" aria-hidden>
                    <VehicleIcon size={18} />
                  </div>
                  <div className="request-copy">
                    <div className="request-title">
                      <h3>
                        {group.brand ? <span>{group.brand} </span> : null}
                        {group.model}
                      </h3>
                      <RequestBadge status={group.status} />
                      {group.count > 1 && <Badge tone="info">{group.count} requests</Badge>}
                    </div>
                    <p>
                      {vehicleTypeLabel(group.type)} · latest {relativeTime(group.latest)} · {group.ids.length}{' '}
                      {group.ids.length === 1 ? 'user' : 'users'}
                    </p>
                    {group.notes && <p className="request-note">“{group.notes}”</p>}
                  </div>
                </div>
                <div className="request-actions">
                  <Button
                    variant={group.status === 'added' ? 'ghost' : 'secondary'}
                    size="sm"
                    icon={<ThumbsUp size={14} />}
                    onClick={() => updateGroup(group, 'added')}
                    disabled={busy || group.status === 'added'}
                  >
                    Added
                  </Button>
                  <Button
                    variant={group.status === 'rejected' ? 'ghost' : 'secondary'}
                    size="sm"
                    icon={<ThumbsDown size={14} />}
                    onClick={() => updateGroup(group, 'rejected')}
                    disabled={busy || group.status === 'rejected'}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateGroup(group, 'new')}
                    disabled={busy || group.status === 'new'}
                  >
                    Reopen
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={search.trim() ? SearchX : Inbox}
            title={search.trim() || statusFilter !== 'new' ? 'No requests match' : 'The request queue is clear'}
            description={
              search.trim() || statusFilter !== 'new'
                ? 'Adjust the status, vehicle type, or search to find other requests.'
                : 'New model requests from mobile users appear here. Users can submit a vehicle from the garage.'
            }
            action={
              statusFilter !== 'new' ? (
                <Button variant="secondary" onClick={() => setStatusFilter('new')}>
                  Show new requests
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}
    </>
  );
}

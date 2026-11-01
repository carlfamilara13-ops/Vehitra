import { useMemo, useState } from 'react';
import { Activity, Download, FileClock, Pencil, Plus, SearchX, Trash2, Users } from 'lucide-react';
import type { AuditEvent, Workspace } from '../types';
import {
  actionKind,
  auditActionLabel,
  auditTargetLabel,
  downloadCsv,
  formatDateTime,
  pluralize,
  relativeTime,
} from '../lib/format';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  SearchInput,
  SectionHeader,
  Segmented,
  StatCard,
} from '../components/ui';

type AuditFilter = 'all' | 'created' | 'updated' | 'removed';

export function AuditPage({ workspace }: { workspace: Workspace }) {
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const events = workspace.audit;
  const todayCount = events.filter((event) => new Date(event.created_at).getTime() >= today.getTime()).length;
  const actors = new Set(events.map((event) => event.actor_email)).size;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      if (filter !== 'all' && actionKind(event.action) !== filter) return false;
      if (!query) return true;
      return `${event.actor_email} ${auditActionLabel(event.action)} ${auditTargetLabel(event)} ${event.target_type}`
        .toLowerCase()
        .includes(query);
    });
  }, [events, filter, search]);

  const exportEvents = () => {
    downloadCsv(
      `vehitra-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Time', 'Actor', 'Action', 'Target type', 'Target', 'Old value', 'New value'],
      filtered.map((event) => [
        formatDateTime(event.created_at),
        event.actor_email,
        auditActionLabel(event.action),
        event.target_type,
        auditTargetLabel(event),
        event.detail.old ? JSON.stringify(event.detail.old) : '',
        event.detail.new ? JSON.stringify(event.detail.new) : '',
      ]),
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="Audit log"
        title="Every write leaves a trace."
        description="Catalog, request, and administrator changes are recorded by database triggers. The console shows the most recent 250 events; older records remain in Supabase."
        actions={
          <Button variant="secondary" icon={<Download size={15} />} onClick={exportEvents} disabled={!filtered.length}>
            Export view
          </Button>
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Recent events" value={events.length.toLocaleString()} hint="Latest 250 loaded" icon={Activity} tone="neutral" />
        <StatCard label="Today" value={todayCount.toLocaleString()} hint="Since local midnight" icon={FileClock} tone={todayCount ? 'accent' : 'success'} />
        <StatCard label="Distinct actors" value={actors.toLocaleString()} hint="In the loaded window" icon={Users} tone="info" />
        <StatCard label="Latest event" value={events[0] ? relativeTime(events[0].created_at) : 'None'} hint={events[0] ? auditActionLabel(events[0].action) : 'No activity yet'} icon={Pencil} tone="neutral" />
      </div>

      <Card className="audit-toolbar">
        <Segmented
          label="Filter audit log by action kind"
          value={filter}
          onChange={(value) => setFilter(value as AuditFilter)}
          options={[
            { value: 'all', label: 'All events' },
            { value: 'created', label: 'Created' },
            { value: 'updated', label: 'Updated' },
            { value: 'removed', label: 'Removed' },
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search actor, action, or target…" label="Search audit events" />
      </Card>

      <SectionHeader
        title="Activity"
        description={`${pluralize(filtered.length, 'event')} shown · append-only and read-only from the console`}
      />

      {filtered.length ? (
        <Card className="table-card">
          <div className="data-table-wrap">
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th className="align-right">Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((event) => {
                  const kind = actionKind(event.action);
                  return (
                    <tr key={event.id}>
                      <td>
                        <div className="table-primary">
                          <strong>{relativeTime(event.created_at)}</strong>
                          <span>{formatDateTime(event.created_at)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="member-cell">
                          <Avatar name={event.actor_email} size="sm" />
                          <span>{event.actor_email}</span>
                        </div>
                      </td>
                      <td>
                        <div className="audit-action">
                          <span className={`audit-kind audit-kind-${kind}`} aria-hidden>
                            {kind === 'created' ? <Plus size={13} /> : kind === 'removed' ? <Trash2 size={13} /> : <Pencil size={13} />}
                          </span>
                          <div>
                            <strong>{auditActionLabel(event.action)}</strong>
                            <span>{event.action}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="table-primary">
                          <strong>{auditTargetLabel(event)}</strong>
                          <span>{event.target_type}</span>
                        </div>
                      </td>
                      <td className="align-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(event)}>
                          Inspect
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={search.trim() ? SearchX : Activity}
            title={search.trim() || filter !== 'all' ? 'No events match' : 'No audit events yet'}
            description={
              search.trim() || filter !== 'all'
                ? 'Adjust the action type or search to find other events.'
                : 'Publishing, editing rules, triaging requests, and managing administrators will appear here.'
            }
            action={
              filter !== 'all' || search ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFilter('all');
                    setSearch('');
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      {selected && <AuditDetail event={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function AuditDetail({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={auditActionLabel(event.action)}
      description={`${event.actor_email} · ${formatDateTime(event.created_at)}`}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="audit-detail-meta">
        <div>
          <span>Event</span>
          <strong className="mono">{String(event.id)}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>
            {auditTargetLabel(event)} <Badge tone="neutral">{event.target_type}</Badge>
          </strong>
        </div>
        <div>
          <span>Operation</span>
          <strong className="mono">{event.action}</strong>
        </div>
      </div>
      <div className="audit-diff">
        <div>
          <h3>Before</h3>
          <pre>{event.detail.old ? JSON.stringify(event.detail.old, null, 2) : 'No previous row recorded.'}</pre>
        </div>
        <div>
          <h3>After</h3>
          <pre>{event.detail.new ? JSON.stringify(event.detail.new, null, 2) : 'No resulting row recorded.'}</pre>
        </div>
      </div>
      <p className="muted audit-footnote">
        Records are written by the database and cannot be edited or deleted from this console.
      </p>
    </Modal>
  );
}

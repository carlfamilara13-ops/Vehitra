import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  GitBranch,
  Pencil,
  Plus,
  SearchX,
  Trash2,
  Wrench,
} from 'lucide-react';
import type { AdminMember, ModelRule, ModelView, ReviewStatus, UnknownHistoryRule, Workspace } from '../types';
import { canWriteCatalog, rulesFor } from '../lib/derive';
import { adminApi, type SaveRuleInput } from '../lib/api';
import {
  formatNumber,
  intervalLabel,
  modelLabel,
  pluralize,
  relativeTime,
  unknownHistoryLabel,
} from '../lib/format';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  ModelStatusBadge,
  Notice,
  PageHeader,
  ReviewBadge,
  SearchInput,
  Select,
  Textarea,
} from '../components/ui';

type RunAction = (label: string, action: () => Promise<unknown>) => Promise<boolean>;
type RuleModalState = { mode: 'create' } | { mode: 'edit'; rule: ModelRule } | null;

export function RulesPage({
  workspace,
  views,
  member,
  runAction,
  focusModelId,
  onFocusModel,
}: {
  workspace: Workspace;
  views: ModelView[];
  member: AdminMember;
  runAction: RunAction;
  focusModelId: string | null;
  onFocusModel: (modelId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(focusModelId ?? views[0]?.model.id ?? null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [ruleModal, setRuleModal] = useState<RuleModalState>(null);
  const [deleteRule, setDeleteRule] = useState<ModelRule | null>(null);
  const [publishConfirm, setPublishConfirm] = useState<ModelView | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = canWriteCatalog(member.role);

  useEffect(() => {
    if (focusModelId) setSelectedId(focusModelId);
  }, [focusModelId]);

  const filteredViews = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return views;
    return views.filter((view) => `${modelLabel(view.model)} ${view.model.slug}`.toLowerCase().includes(query));
  }, [views, search]);

  const view = views.find((item) => item.model.id === selectedId) ?? filteredViews[0] ?? null;

  useEffect(() => {
    if (!view) return;
    const preferred = view.draft?.version ?? view.current?.version ?? null;
    if (preferred != null) setSelectedVersion(preferred);
  }, [view?.model.id, view?.draft?.version, view?.current?.version]);

  const selectedVersionRow = view
    ? workspace.versions.find((version) => version.model_id === view.model.id && version.version === selectedVersion) ?? null
    : null;
  const isPublishedView = selectedVersionRow?.published === true;
  const rules = view && selectedVersion != null ? rulesFor(workspace, view.model.id, selectedVersion) : [];
  const versionOptions = view
    ? workspace.versions
        .filter((version) => version.model_id === view.model.id && (version.published || version.version === view.draft?.version))
        .sort((a, b) => b.version - a.version)
    : [];
  const draft = view?.draft ?? null;
  const reviewableDrafts = rules.filter((rule) => rule.review_status === 'draft').length;

  const startRevision = async () => {
    if (!view) return;
    setBusy(true);
    await runAction(`Draft revision created for ${modelLabel(view.model)}`, () => adminApi.beginVersion(view.model.id));
    setBusy(false);
  };

  const publish = async () => {
    if (!view || !draft) return;
    setBusy(true);
    const ok = await runAction(`Catalog v${draft.version} published`, () =>
      adminApi.publishVersion(view.model.id, draft.version),
    );
    setBusy(false);
    if (ok) setPublishConfirm(null);
  };

  const removeRule = async () => {
    if (!deleteRule) return;
    setBusy(true);
    const ok = await runAction('Maintenance rule removed', () =>
      adminApi.deleteRule(deleteRule.model_id, deleteRule.component_id, deleteRule.version),
    );
    setBusy(false);
    if (ok) setDeleteRule(null);
  };

  return (
    <>
      <PageHeader
        eyebrow="Maintenance rules"
        title="Evidence first. Intervals second."
        description="Draft versions are private until published. Published rules are frozen, but a named reviewer can still update the review status and source note."
        actions={
          view && canWrite ? (
            draft ? (
              <>
                <Button variant="secondary" icon={<GitBranch size={15} />} onClick={() => setPublishConfirm(view)} disabled={busy}>
                  Publish v{draft.version}
                </Button>
                <Button variant="primary" icon={<Plus size={16} />} onClick={() => setRuleModal({ mode: 'create' })}>
                  Add rule
                </Button>
              </>
            ) : (
              <Button variant="primary" icon={<GitBranch size={16} />} loading={busy} onClick={startRevision}>
                Start revision
              </Button>
            )
          ) : undefined
        }
      />

      <div className="rules-layout">
        <Card className="model-picker">
          <div className="model-picker-head">
            <div>
              <h2>Models</h2>
              <p className="muted">{pluralize(views.length, 'model')}</p>
            </div>
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Find a model…" label="Find a model" />
          <div className="model-picker-list" role="list">
            {filteredViews.map((item) => {
              const selected = item.model.id === view?.model.id;
              return (
                <button
                  key={item.model.id}
                  type="button"
                  className={selected ? 'model-pick active' : 'model-pick'}
                  onClick={() => {
                    setSelectedId(item.model.id);
                    onFocusModel(item.model.id);
                  }}
                  aria-current={selected ? 'true' : undefined}
                >
                  <span className="model-pick-icon" aria-hidden>
                    <Wrench size={15} />
                  </span>
                  <span className="model-pick-copy">
                    <strong>{modelLabel(item.model)}</strong>
                    <span>
                      {item.draft ? `Draft v${item.draft.version}` : `v${item.current?.version ?? item.model.current_version}`} ·{' '}
                      {item.draft ? item.draft_rule_count : item.rule_count} rules
                    </span>
                  </span>
                  {item.draft && <span className="draft-dot" aria-label="Open draft" />}
                  <ChevronRight size={15} aria-hidden />
                </button>
              );
            })}
            {!filteredViews.length && <p className="muted model-picker-empty">No models match that search.</p>}
          </div>
        </Card>

        {view ? (
          <div className="rules-main">
            <Card className="rules-model-head">
              <div className="rules-model-title">
                <div>
                  <span className="eyebrow">{view.model.brand?.name ?? 'Generic'}</span>
                  <h2>{view.model.name}</h2>
                  <p className="muted">
                    {view.model.type.name} · {view.draft ? 'Draft revision in progress' : 'No open draft'}
                  </p>
                </div>
                <div className="rules-model-badges">
                  <ModelStatusBadge status={view.status} />
                  {view.draft && <Badge tone="warning">v{view.draft.version} draft</Badge>}
                </div>
              </div>
              <div className="version-tabs" role="group" aria-label="Catalog version to inspect">
                {versionOptions.map((version) => (
                  <button
                    key={version.version}
                    type="button"
                    className={version.version === selectedVersion ? 'version-tab active' : 'version-tab'}
                    onClick={() => setSelectedVersion(version.version)}
                    aria-pressed={version.version === selectedVersion}
                  >
                    v{version.version}
                    <span>{version.published ? 'Published' : 'Draft'}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Notice
              tone={isPublishedView ? 'info' : 'warning'}
              title={isPublishedView ? 'Published version is immutable' : 'Draft is private to admins'}
            >
              {isPublishedView
                ? 'Intervals and components cannot change here. You can still mark a rule reviewed or correct its source note; that does not alter any number an existing vehicle uses.'
                : `This version is not visible to the mobile app. ${reviewableDrafts} of ${rules.length} rules still need review. Start a new revision to change published values.`}
              <div className="notice-inline-actions">
                {!draft && canWrite && (
                  <button type="button" className="link-btn" onClick={startRevision} disabled={busy}>
                    <GitBranch size={14} /> Start a revision
                  </button>
                )}
                {draft && canWrite && (
                  <button type="button" className="link-btn" onClick={() => setPublishConfirm(view)}>
                    <CheckCircle2 size={14} /> Review publish
                  </button>
                )}
              </div>
            </Notice>

            {rules.length ? (
              <Card className="rules-table-card">
                <div className="rules-table-head">
                  <span>Component</span>
                  <span>Interval</span>
                  <span>Unknown history</span>
                  <span>Review</span>
                  <span className="align-right">Actions</span>
                </div>
                <div className="rules-table">
                  {rules.map((rule) => (
                    <div key={`${rule.model_id}-${rule.version}-${rule.component_id}`} className="rule-row">
                      <div className="rule-component">
                        <strong>{rule.component.name}</strong>
                        <span>{rule.component.category.replace(/_/g, ' ')}</span>
                      </div>
                      <div>
                        <strong>{intervalLabel(rule)}</strong>
                        <span>Warn at {formatNumber(rule.warn_remaining_pct)}% remaining</span>
                      </div>
                      <div>
                        <strong>{unknownHistoryLabel(rule)}</strong>
                        <span>{rule.reviewed_by ? `Reviewed by ${rule.reviewed_by}` : 'No reviewer recorded'}</span>
                      </div>
                      <div className="rule-review">
                        <ReviewBadge status={rule.review_status} />
                        <span>{rule.reviewed_at ? relativeTime(rule.reviewed_at) : 'Needs review'}</span>
                      </div>
                      <div className="rule-actions">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Pencil size={13} />}
                          onClick={() => setRuleModal({ mode: 'edit', rule })}
                          disabled={!canWrite}
                          title={!canWrite ? 'Catalog writes require a catalog or super admin role' : undefined}
                        >
                          {isPublishedView ? 'Review' : 'Edit'}
                        </Button>
                        {!isPublishedView && canWrite && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 size={13} />}
                            onClick={() => setDeleteRule(rule)}
                            title="Remove from draft"
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                      {rule.source_note && <p className="rule-source">{rule.source_note}</p>}
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Card>
                <EmptyState
                  icon={ClipboardList}
                  title={isPublishedView ? 'This version has no rules' : 'Nothing in this draft yet'}
                  description={
                    isPublishedView
                      ? 'A published version must contain at least one rule. Create a revision to add maintenance data.'
                      : 'Add the first maintenance rule, or start a revision from the published version to copy its rules.'
                  }
                  action={
                    !isPublishedView && canWrite ? (
                      <Button variant="primary" icon={<Plus size={15} />} onClick={() => setRuleModal({ mode: 'create' })}>
                        Add rule
                      </Button>
                    ) : !draft && canWrite ? (
                      <Button variant="secondary" icon={<GitBranch size={15} />} onClick={startRevision} loading={busy}>
                        Start revision
                      </Button>
                    ) : undefined
                  }
                />
              </Card>
            )}

            <div className="rules-help-grid">
              <Card className="help-card">
                <span className="help-icon" aria-hidden>
                  <AlertTriangle size={17} />
                </span>
                <div>
                  <h3>Unreviewed is a valid state</h3>
                  <p>Leave an interval unset when the evidence is missing. The app labels it clearly instead of inventing a number.</p>
                </div>
              </Card>
              <Card className="help-card">
                <span className="help-icon" aria-hidden>
                  <GitBranch size={17} />
                </span>
                <div>
                  <h3>Existing vehicles keep their snapshot</h3>
                  <p>Publishing a new version updates new downloads. Owners explicitly accept the update on their existing vehicles.</p>
                </div>
              </Card>
            </div>
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={SearchX}
              title="Select a model"
              description="Choose a model from the list to inspect its current rules and drafts."
            />
          </Card>
        )}
      </div>

      {ruleModal && view && selectedVersionRow && (
        <RuleModal
          mode={ruleModal.mode}
          view={view}
          version={selectedVersionRow}
          rule={ruleModal.mode === 'edit' ? ruleModal.rule : null}
          components={workspace.components}
          canWrite={canWrite}
          runAction={runAction}
          onClose={() => setRuleModal(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteRule)}
        title="Remove maintenance rule?"
        description={deleteRule ? `${deleteRule.component.name} will be removed from the draft only.` : undefined}
        confirmLabel="Remove rule"
        tone="danger"
        busy={busy}
        onClose={() => setDeleteRule(null)}
        onConfirm={removeRule}
      >
        <p className="muted">This cannot affect the published version. The removal is recorded in the audit log.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(publishConfirm)}
        title={publishConfirm?.draft ? `Publish catalog v${publishConfirm.draft.version}?` : 'Publish catalog version?'}
        description={publishConfirm ? modelLabel(publishConfirm.model) : undefined}
        confirmLabel="Publish version"
        busy={busy}
        onClose={() => setPublishConfirm(null)}
        onConfirm={publish}
      >
        <p className="muted">
          {publishConfirm?.draft
            ? `${publishConfirm.draft_rule_count} rules in this draft, ${publishConfirm.draft_rule_count - publishConfirm.draft_reviewed_count} still unreviewed. Publishing is immutable and immediately available to the mobile catalog.`
            : 'Publishing is immutable and immediately available to the mobile catalog.'}
        </p>
      </ConfirmDialog>
    </>
  );
}

function RuleModal({
  mode,
  view,
  version,
  rule,
  components,
  canWrite,
  runAction,
  onClose,
}: {
  mode: 'create' | 'edit';
  view: ModelView;
  version: Workspace['versions'][number];
  rule: ModelRule | null;
  components: Workspace['components'];
  canWrite: boolean;
  runAction: RunAction;
  onClose: () => void;
}) {
  const published = version.published;
  const applicable = components.filter(
    (component) => component.applies_to_types.includes(view.model.type.code) || component.id === rule?.component_id,
  );
  const [componentId, setComponentId] = useState(rule?.component_id ?? applicable[0]?.id ?? '');
  const [intervalKm, setIntervalKm] = useState(rule?.interval_km != null ? String(rule.interval_km) : '');
  const [intervalDays, setIntervalDays] = useState(rule?.interval_days != null ? String(rule.interval_days) : '');
  const [warn, setWarn] = useState(String(rule?.warn_remaining_pct ?? 25));
  const [unknownType, setUnknownType] = useState<UnknownHistoryRule['type'] | ''>(rule?.unknown_history_rule?.type ?? '');
  const [unknownValue, setUnknownValue] = useState(
    rule?.unknown_history_rule?.value != null ? String(rule.unknown_history_rule.value) : '',
  );
  const [sourceNote, setSourceNote] = useState(rule?.source_note ?? '');
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(rule?.review_status ?? 'draft');
  const [reviewedBy, setReviewedBy] = useState(rule?.reviewed_by ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!componentId) return setError('Choose a component.');
    if (reviewStatus === 'reviewed' && !reviewedBy.trim()) return setError('A reviewer name is required when marked reviewed.');
    const numericWarn = Number(warn);
    if (!Number.isFinite(numericWarn) || numericWarn < 0 || numericWarn > 100) {
      return setError('Warning threshold must be between 0 and 100.');
    }
    const numericKm = intervalKm.trim() ? Number(intervalKm) : null;
    const numericDays = intervalDays.trim() ? Number(intervalDays) : null;
    if (numericKm != null && (!Number.isInteger(numericKm) || numericKm <= 0)) {
      return setError('Distance interval must be a positive whole number.');
    }
    if (numericDays != null && (!Number.isInteger(numericDays) || numericDays <= 0)) {
      return setError('Time interval must be a positive whole number.');
    }
    let unknownRule: UnknownHistoryRule | null = null;
    if (unknownType) {
      const value = Number(unknownValue);
      if (!Number.isFinite(value) || value <= 0) return setError('Unknown-history value must be greater than zero.');
      unknownRule = { type: unknownType, value };
    }

    setBusy(true);
    const ok = published
      ? await runAction('Rule review updated', () =>
          adminApi.reviewRule({
            modelId: view.model.id,
            componentId,
            version: version.version,
            reviewed: reviewStatus === 'reviewed',
            reviewedBy: reviewStatus === 'reviewed' ? reviewedBy.trim() : null,
            sourceNote: sourceNote.trim() || null,
          }),
        )
      : await runAction(mode === 'create' ? 'Maintenance rule added' : 'Maintenance rule updated', () => {
          const input: SaveRuleInput = {
            modelId: view.model.id,
            componentId,
            version: version.version,
            intervalKm: numericKm,
            intervalDays: numericDays,
            warnRemainingPct: numericWarn,
            unknownHistoryRule: unknownRule,
            sourceNote: sourceNote.trim() || null,
            reviewStatus,
            reviewedBy: reviewStatus === 'reviewed' ? reviewedBy.trim() : null,
          };
          return adminApi.saveRule(input);
        });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Add maintenance rule' : published ? 'Review published rule' : 'Edit maintenance rule'}
      description={
        published
          ? 'Only review metadata and the source note can change on a published version.'
          : `Editing draft v${version.version}. Nothing here is visible in the mobile app until the version is published.`
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!canWrite}
            onClick={() => document.getElementById('rule-form-submit')?.click()}
          >
            {published ? 'Save review' : mode === 'create' ? 'Add rule' : 'Save rule'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label="Component" htmlFor="rule-component" hint={mode === 'edit' ? 'Components cannot be swapped within the same rule.' : undefined}>
          <Select id="rule-component" value={componentId} onChange={(event) => setComponentId(event.target.value)} disabled={mode === 'edit'}>
            {applicable.map((component) => (
              <option key={component.id} value={component.id}>
                {component.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category">
          <Input value={applicable.find((component) => component.id === componentId)?.category.replace(/_/g, ' ') ?? ''} disabled />
        </Field>
        <div className="field-pair">
          <Field label="Distance interval (km)" htmlFor="rule-km" hint="Leave empty when the source does not specify one.">
            <Input
              id="rule-km"
              type="number"
              min={1}
              step={1}
              value={intervalKm}
              onChange={(event) => setIntervalKm(event.target.value)}
              disabled={published}
            />
          </Field>
          <Field label="Time interval (days)" htmlFor="rule-days" hint="Optional.">
            <Input
              id="rule-days"
              type="number"
              min={1}
              step={1}
              value={intervalDays}
              onChange={(event) => setIntervalDays(event.target.value)}
              disabled={published}
            />
          </Field>
        </div>
        <div className="field-pair">
          <Field label="Unknown history rule" htmlFor="rule-unknown-type" hint="How to treat a component with no service history.">
            <Select
              id="rule-unknown-type"
              value={unknownType}
              onChange={(event) => setUnknownType(event.target.value as UnknownHistoryRule['type'] | '')}
              disabled={published}
            >
              <option value="">Not set</option>
              <option value="remaining_km">Remaining km</option>
              <option value="percent_used">Percent used</option>
            </Select>
          </Field>
          <Field label="Value" htmlFor="rule-unknown-value">
            <Input
              id="rule-unknown-value"
              type="number"
              min={0}
              step="any"
              value={unknownValue}
              onChange={(event) => setUnknownValue(event.target.value)}
              disabled={published || !unknownType}
            />
          </Field>
        </div>
        <Field label="Warning threshold (%)" htmlFor="rule-warn" hint="Show a warning when this percentage of the interval remains.">
          <Input
            id="rule-warn"
            type="number"
            min={0}
            max={100}
            step="any"
            value={warn}
            onChange={(event) => setWarn(event.target.value)}
            disabled={published}
          />
        </Field>
        <Field label="Source note" htmlFor="rule-source" hint="Name the manual, page, bulletin, or reviewer evidence.">
          <Textarea id="rule-source" rows={3} value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} />
        </Field>
        <div className="field-pair">
          <Field label="Review status" htmlFor="rule-review">
            <Select id="rule-review" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as ReviewStatus)}>
              <option value="draft">Unreviewed</option>
              <option value="reviewed">Reviewed</option>
            </Select>
          </Field>
          <Field label="Reviewed by" htmlFor="rule-reviewer" hint="Required when the status is reviewed.">
            <Input
              id="rule-reviewer"
              value={reviewedBy}
              onChange={(event) => setReviewedBy(event.target.value)}
              disabled={reviewStatus !== 'reviewed'}
              placeholder="Full name"
            />
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button id="rule-form-submit" type="submit" className="visually-hidden" tabIndex={-1}>
          Submit
        </button>
      </form>
    </Modal>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Bike,
  Bus,
  Car,
  CarFront,
  CircleOff,
  Download,
  Edit3,
  Plus,
  SearchX,
  Truck,
  Wrench,
} from 'lucide-react';
import type { AdminMember, ModelView, VehicleTypeCode, Workspace } from '../types';
import { VEHICLE_TYPES } from '../types';
import { canWriteCatalog } from '../lib/derive';
import { adminApi, publicModelImageUrl, type CreateModelInput } from '../lib/api';
import { downloadCsv, formatNumber, modelLabel, yearsLabel } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  ModelStatusBadge,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
} from '../components/ui';

type StatusFilter = 'all' | 'published' | 'draft' | 'archived';
type RunAction = (label: string, action: () => Promise<unknown>) => Promise<boolean>;
type ModalState = { mode: 'create' } | { mode: 'edit'; view: ModelView } | null;

const TYPE_ICONS: Record<VehicleTypeCode, typeof Car> = {
  motorcycle: Bike,
  car: CarFront,
  bicycle: Bike,
  truck: Truck,
  bus: Bus,
  van: Car,
  other: CircleOff,
};

export function CatalogPage({
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
  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState<VehicleTypeCode | 'all'>('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const canWrite = canWriteCatalog(member.role);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return views.filter((view) => {
      if (status !== 'all' && view.status !== status) return false;
      if (type !== 'all' && view.model.type.code !== type) return false;
      if (query) {
        const haystack = [modelLabel(view.model), view.model.slug, view.model.type.name, view.model.brand?.name ?? '']
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [views, status, type, search]);

  const statusOptions: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: views.length },
    { value: 'published', label: 'Published', count: views.filter((view) => view.status === 'published').length },
    { value: 'draft', label: 'Draft', count: views.filter((view) => view.status === 'draft').length },
    { value: 'archived', label: 'Archived', count: views.filter((view) => view.status === 'archived').length },
  ];

  const exportCatalog = () => {
    downloadCsv(
      'vehitra-catalog.csv',
      ['Brand', 'Model', 'Type', 'Years', 'Status', 'Current version', 'Rules', 'Reviewed', 'Open draft'],
      filtered.map((view) => [
        view.model.brand?.name ?? 'Generic',
        view.model.name,
        view.model.type.name,
        yearsLabel(view.model.year_from, view.model.year_to),
        view.status,
        `v${view.model.current_version}`,
        view.rule_count,
        view.reviewed_count,
        view.draft ? `v${view.draft.version}` : '',
      ]),
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="Vehicle catalog"
        title="Models the mobile app can support."
        description="Every model has a published version, or a draft that remains private until review is complete. Archived models stay visible for historical vehicles."
        actions={
          <>
            <Button variant="secondary" icon={<Download size={15} />} onClick={exportCatalog} disabled={!filtered.length}>
              Export CSV
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={() => setModal({ mode: 'create' })}
              disabled={!canWrite}
              title={!canWrite ? 'Catalog writes require a catalog or super admin role' : undefined}
            >
              Add vehicle
            </Button>
          </>
        }
      />

      <div className="catalog-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search brand, model, or slug…" label="Search catalog" />
        <Segmented value={status} onChange={setStatus} options={statusOptions} label="Filter by status" />
        <Select value={type} onChange={(event) => setType(event.target.value as VehicleTypeCode | 'all')} aria-label="Filter by vehicle type">
          <option value="all">All types</option>
          {VEHICLE_TYPES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="catalog-summary">
        <span>
          <strong>{formatNumber(filtered.length)}</strong> shown
        </span>
        <span>
          <strong>{formatNumber(views.filter((view) => view.draft).length)}</strong> open drafts
        </span>
        <span>
          <strong>{formatNumber(views.reduce((sum, view) => sum + view.rule_count, 0))}</strong> current rules
        </span>
        <span>
          <strong>{formatNumber(workspace.models.filter((model) => !model.active).length)}</strong> archived
        </span>
      </div>

      {filtered.length ? (
        <div className="vehicle-grid">
          {filtered.map((view) => {
            const Icon = TYPE_ICONS[view.model.type.code] ?? Car;
            const hasDraft = Boolean(view.draft);
            return (
              <Card as="article" key={view.model.id} className={`vehicle-card ${view.status === 'archived' ? 'is-archived' : ''}`}>
                <div className="vehicle-card-head">
                  <span className={`vehicle-type-icon type-${view.model.type.code}`} aria-hidden>
                    <Icon size={20} />
                  </span>
                  <div className="vehicle-title">
                    <span className="vehicle-brand">{view.model.brand?.name ?? 'Generic'}</span>
                    <h2>{view.model.name}</h2>
                  </div>
                  <ModelStatusBadge status={view.status} />
                </div>

                <div className="vehicle-meta">
                  <span>{view.model.type.name}</span>
                  <span aria-hidden>·</span>
                  <span>{yearsLabel(view.model.year_from, view.model.year_to)}</span>
                  <span aria-hidden>·</span>
                  <span>v{view.model.current_version}</span>
                </div>

                <div className="vehicle-badges">
                  {hasDraft && view.status === 'published' && <Badge tone="warning">v{view.draft!.version} draft open</Badge>}
                  {view.status === 'draft' && <Badge tone="warning">Not visible in app</Badge>}
                  {view.rule_count === 0 && <Badge tone="danger">No current rules</Badge>}
                </div>

                <dl className="vehicle-stats">
                  <div>
                    <dt>Current rules</dt>
                    <dd>{view.rule_count}</dd>
                  </div>
                  <div>
                    <dt>Reviewed</dt>
                    <dd>{view.reviewed_count}</dd>
                  </div>
                  <div>
                    <dt>Draft rules</dt>
                    <dd>{view.draft ? view.draft_rule_count : ' '}</dd>
                  </div>
                </dl>

                <div className="vehicle-card-foot">
                  <Button variant="secondary" size="sm" icon={<Wrench size={14} />} onClick={() => openRules(view.model.id)}>
                    Maintenance
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Edit3 size={14} />}
                    onClick={() => setModal({ mode: 'edit', view })}
                    disabled={!canWrite}
                    title={!canWrite ? 'Catalog writes require a catalog or super admin role' : undefined}
                  >
                    Edit details
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={SearchX}
            title="No models match those filters"
            description="Clear the search or switch filters. Draft models are included here even though the mobile app cannot see them yet."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setStatus('all');
                  setType('all');
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Card>
      )}

      {modal && (
        <VehicleModal
          mode={modal.mode}
          view={modal.mode === 'edit' ? modal.view : null}
          workspace={workspace}
          runAction={runAction}
          onClose={() => setModal(null)}
          onCreated={(modelId) => {
            setModal(null);
            openRules(modelId);
          }}
        />
      )}
    </>
  );
}

function VehicleModal({
  mode,
  view,
  workspace,
  runAction,
  onClose,
  onCreated,
}: {
  mode: 'create' | 'edit';
  view: ModelView | null;
  workspace: Workspace;
  runAction: RunAction;
  onClose: () => void;
  onCreated: (modelId: string) => void;
}) {
  const brands = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of workspace.models) {
      if (model.brand) map.set(model.brand.slug, model.brand.name);
    }
    return [...map.entries()].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [workspace.models]);

  const [brandChoice, setBrandChoice] = useState(view?.model.brand?.slug ?? (brands[0]?.slug ?? 'new'));
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandSlug, setNewBrandSlug] = useState('');
  const [name, setName] = useState(view?.model.name ?? '');
  const [slug, setSlug] = useState(view?.model.slug ?? '');
  const [typeCode, setTypeCode] = useState<VehicleTypeCode>(view?.model.type.code ?? 'motorcycle');
  const [yearFrom, setYearFrom] = useState(view?.model.year_from != null ? String(view.model.year_from) : '');
  const [yearTo, setYearTo] = useState(view?.model.year_to != null ? String(view.model.year_to) : '');
  const [sortOrder, setSortOrder] = useState(String(view?.model.sort_order ?? 100));
  const [active, setActive] = useState(view?.model.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const previewUrl = useMemo(() => imageFile ? URL.createObjectURL(imageFile) : null, [imageFile]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const isCreate = mode === 'create';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const numericSort = Number(sortOrder);
    if (!name.trim()) return setError('Model name is required.');
    if (isCreate && !slug.trim()) return setError('Slug is required.');
    if (!Number.isFinite(numericSort)) return setError('Sort order must be a number.');
    const from = yearFrom.trim() ? Number(yearFrom) : null;
    const to = yearTo.trim() ? Number(yearTo) : null;
    if ((from != null && !Number.isInteger(from)) || (to != null && !Number.isInteger(to))) {
      return setError('Model years must be whole numbers.');
    }
    if (from != null && to != null && to < from) return setError('Year to must not be earlier than year from.');
    if (isCreate && brandChoice === 'new' && (!newBrandName.trim() || !newBrandSlug.trim())) {
      return setError('Enter the new brand name and slug.');
    }

    setBusy(true);
    let createdId: string | null = null;
    const ok = await runAction(isCreate ? 'Vehicle model created' : 'Vehicle model updated', async () => {
      if (isCreate) {
        let brandSlug: string | null = brandChoice === 'new' ? newBrandSlug.trim() : brandChoice;
        if (brandChoice === 'generic') brandSlug = null;
        if (brandChoice === 'new') {
          await adminApi.createBrand(newBrandSlug.trim(), newBrandName.trim());
        }
        const input: CreateModelInput = {
          slug: slug.trim(),
          name: name.trim(),
          brandSlug,
          typeCode,
          yearFrom: from,
          yearTo: to,
          sortOrder: numericSort,
        };
        createdId = await adminApi.createModel(input);
      } else if (view) {
        await adminApi.updateModel({
          modelId: view.model.id,
          name: name.trim(),
          yearFrom: from,
          yearTo: to,
          active,
          sortOrder: numericSort,
        });
      }
      const modelId = isCreate ? createdId : view?.model.id;
      if (modelId && imageFile) await adminApi.uploadModelImage(modelId, imageFile);
      else if (modelId && removeImage) await adminApi.removeModelImage(modelId);
    });
    setBusy(false);
    if (!ok) return;
    if (isCreate && createdId) onCreated(createdId);
    else onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isCreate ? 'Add vehicle model' : 'Edit vehicle model'}
      description={
        isCreate
          ? 'A new model starts as an unpublished v1 with no maintenance rules. Add rules before publishing it.'
          : 'Name, years, sort order, and availability only. Type and brand are immutable because existing vehicles reference this model.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => document.getElementById('vehicle-form-submit')?.click()}>
            {isCreate ? 'Create draft model' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="vehicle-form" onSubmit={submit} className="form-grid">
        {isCreate ? (
          <>
            <Field label="Brand" htmlFor="vehicle-brand" hint="Use Generic for a model that is not tied to a make.">
              <Select id="vehicle-brand" value={brandChoice} onChange={(event) => setBrandChoice(event.target.value)}>
                {brands.map((brand) => (
                  <option key={brand.slug} value={brand.slug}>
                    {brand.name}
                  </option>
                ))}
                <option value="generic">Generic (no brand)</option>
                <option value="new">+ New brand…</option>
              </Select>
            </Field>
            {brandChoice === 'new' && (
              <>
                <Field label="Brand name" htmlFor="brand-name">
                  <Input id="brand-name" value={newBrandName} onChange={(event) => setNewBrandName(event.target.value)} placeholder="Honda" />
                </Field>
                <Field label="Brand slug" htmlFor="brand-slug" hint="Lowercase letters, digits, and hyphens.">
                  <Input id="brand-slug" value={newBrandSlug} onChange={(event) => setNewBrandSlug(event.target.value)} placeholder="honda" />
                </Field>
              </>
            )}
            <Field label="Model name" htmlFor="model-name">
              <Input id="model-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Click 125" />
            </Field>
            <Field label="Model slug" htmlFor="model-slug" hint="Must be unique across the catalog.">
              <Input id="model-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="honda-click-125" />
            </Field>
            <Field label="Vehicle type" htmlFor="model-type">
              <Select id="model-type" value={typeCode} onChange={(event) => setTypeCode(event.target.value as VehicleTypeCode)}>
                {VEHICLE_TYPES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Brand">
              <Input value={view?.model.brand?.name ?? 'Generic'} disabled />
            </Field>
            <Field label="Vehicle type">
              <Input value={view?.model.type.name ?? ''} disabled />
            </Field>
            <Field label="Model name" htmlFor="model-name-edit">
              <Input id="model-name-edit" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Model slug">
              <Input value={view?.model.slug ?? ''} disabled />
            </Field>
            <Field label="Availability">
              <label className="checkbox-row">
                <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
                <span>Active in the vehicle library</span>
              </label>
            </Field>
          </>
        )}

        <div className="field-pair">
          <Field label="Year from" htmlFor="model-year-from">
            <Input id="model-year-from" inputMode="numeric" value={yearFrom} onChange={(event) => setYearFrom(event.target.value)} placeholder="2024" />
          </Field>
          <Field label="Year to" htmlFor="model-year-to">
            <Input id="model-year-to" inputMode="numeric" value={yearTo} onChange={(event) => setYearTo(event.target.value)} placeholder="2026" />
          </Field>
        </div>
        <Field label="Sort order" htmlFor="model-sort" hint="Lower numbers appear first; generic models usually use 900.">
          <Input id="model-sort" inputMode="numeric" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
        </Field>
        <Field label="Vehicle image" htmlFor="model-image" hint="JPG, PNG or WebP, up to 8 MB. Public catalog image; no account data is used.">
          <div className="model-image-field">
            {(previewUrl || (view?.model.image_storage_path && !removeImage)) && (
              <img src={previewUrl ?? publicModelImageUrl(view!.model.image_storage_path!)} alt="Vehicle model preview" />
            )}
            <Input
              id="model-image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setImageError(null);
                if (file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                  setImageError('Choose a JPG, PNG, or WebP image.');
                  event.target.value = '';
                  setImageFile(null);
                  return;
                }
                if (file && file.size > 8 * 1024 * 1024) {
                  setImageError('Image must be 8 MB or smaller.');
                  event.target.value = '';
                  setImageFile(null);
                  return;
                }
                setImageFile(file);
                setRemoveImage(false);
              }}
            />
            {view?.model.image_storage_path && !removeImage && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { setImageFile(null); setRemoveImage(true); }}>
                Remove image
              </Button>
            )}
            {removeImage && <Button type="button" variant="ghost" size="sm" onClick={() => setRemoveImage(false)}>Keep current image</Button>}
            {imageError && <p className="form-error" role="alert">{imageError}</p>}
          </div>
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button id="vehicle-form-submit" type="submit" className="visually-hidden" tabIndex={-1}>
          Submit
        </button>
      </form>
    </Modal>
  );
}

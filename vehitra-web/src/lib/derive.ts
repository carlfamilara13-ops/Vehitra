import type {
  AdminRole,
  CatalogModel,
  ModelRequest,
  ModelRule,
  ModelVersion,
  ModelView,
  RequestGroup,
  Workspace,
} from '../types';
import { modelLabel, requestGroupKey } from './format';

export function canWriteCatalog(role: AdminRole): boolean {
  return role === 'super_admin' || role === 'catalog_admin';
}

export function canManageAdmins(role: AdminRole): boolean {
  return role === 'super_admin';
}

export function buildModelViews(workspace: Workspace): ModelView[] {
  return workspace.models
    .map((model) => buildModelView(model, workspace.versions, workspace.rules))
    .sort((a, b) => {
      if (a.model.sort_order !== b.model.sort_order) return a.model.sort_order - b.model.sort_order;
      return modelLabel(a.model).localeCompare(modelLabel(b.model));
    });
}

export function buildModelView(
  model: CatalogModel,
  versions: ModelVersion[],
  rules: ModelRule[],
): ModelView {
  const modelVersions = versions
    .filter((version) => version.model_id === model.id)
    .sort((a, b) => b.version - a.version);
  const current = modelVersions.find((version) => version.version === model.current_version) ?? null;
  const draft = modelVersions.find((version) => !version.published) ?? null;
  const status: ModelView['status'] = !model.active
    ? 'archived'
    : current?.published
      ? 'published'
      : 'draft';
  const currentRules = current ? rules.filter((rule) => rule.model_id === model.id && rule.version === current.version) : [];
  const draftRules = draft ? rules.filter((rule) => rule.model_id === model.id && rule.version === draft.version) : [];
  return {
    model,
    current,
    draft,
    status,
    rule_count: currentRules.length,
    reviewed_count: currentRules.filter((rule) => rule.review_status === 'reviewed').length,
    draft_rule_count: draftRules.length,
    draft_reviewed_count: draftRules.filter((rule) => rule.review_status === 'reviewed').length,
  };
}

export function findModelView(views: ModelView[], modelId: string | null): ModelView | null {
  if (!modelId) return null;
  return views.find((view) => view.model.id === modelId) ?? null;
}

export function rulesFor(workspace: Workspace, modelId: string, version: number): ModelRule[] {
  return workspace.rules
    .filter((rule) => rule.model_id === modelId && rule.version === version)
    .sort((a, b) => {
      const category = a.component.category.localeCompare(b.component.category);
      return category !== 0 ? category : a.component.name.localeCompare(b.component.name);
    });
}

export function buildRequestGroups(requests: ModelRequest[]): RequestGroup[] {
  const groups = new Map<string, RequestGroup>();
  for (const request of requests) {
    const key = requestGroupKey(request);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.ids.push(request.id);
      if (new Date(request.created_at).getTime() > new Date(existing.latest).getTime()) {
        existing.latest = request.created_at;
      }
      if (!existing.notes && request.notes) existing.notes = request.notes;
    } else {
      groups.set(key, {
        key,
        type: request.vehicle_type_code,
        brand: request.brand_text?.trim() || null,
        model: request.model_text.trim(),
        status: request.status,
        count: 1,
        latest: request.created_at,
        notes: request.notes,
        ids: [request.id],
      });
    }
  }
  return [...groups.values()].sort((a, b) => {
    const statusOrder = { new: 0, added: 1, rejected: 2 };
    if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
    return new Date(b.latest).getTime() - new Date(a.latest).getTime();
  });
}

export function workspaceCounts(workspace: Workspace, views: ModelView[]) {
  const published = views.filter((view) => view.status === 'published').length;
  const draft = views.filter((view) => view.status === 'draft' || view.draft).length;
  const archived = views.filter((view) => view.status === 'archived').length;
  const openDrafts = views.filter((view) => view.draft).length;
  const reviewedRules = workspace.rules.filter((rule) => rule.review_status === 'reviewed').length;
  const draftRules = workspace.rules.filter((rule) => rule.review_status === 'draft').length;
  const newRequests = workspace.requests.filter((request) => request.status === 'new').length;
  const activeAdmins = workspace.admins.filter((member) => member.status === 'active').length;
  return {
    total: views.length,
    published,
    draft,
    archived,
    openDrafts,
    reviewedRules,
    draftRules,
    newRequests,
    activeAdmins,
  };
}

export function requestCounts(groups: RequestGroup[]) {
  return {
    all: groups.reduce((sum, group) => sum + group.count, 0),
    groups: groups.length,
    new: groups.filter((group) => group.status === 'new').reduce((sum, group) => sum + group.count, 0),
    added: groups.filter((group) => group.status === 'added').reduce((sum, group) => sum + group.count, 0),
    rejected: groups.filter((group) => group.status === 'rejected').reduce((sum, group) => sum + group.count, 0),
  };
}

export function modelVersionSummary(views: ModelView[], workspace: Workspace) {
  return workspace.versions
    .map((version) => ({
      ...version,
      model: workspace.models.find((model) => model.id === version.model_id) ?? null,
      view: views.find((view) => view.model.id === version.model_id) ?? null,
      rule_count: workspace.rules.filter(
        (rule) => rule.model_id === version.model_id && rule.version === version.version,
      ).length,
      draft_count: workspace.rules.filter(
        (rule) =>
          rule.model_id === version.model_id &&
          rule.version === version.version &&
          rule.review_status === 'draft',
      ).length,
    }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

import type { Session } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import type {
  AdminMember,
  AdminRole,
  AdminStatus,
  AuditEvent,
  CatalogModel,
  ComponentDefinition,
  HealthSnapshot,
  ModelRequest,
  ModelRule,
  ModelVersion,
  ReviewStatus,
  UnknownHistoryRule,
  VehicleTypeCode,
  Workspace,
  WorkspaceBundle,
} from '../types';

export { isSupabaseConfigured };

export function publicModelImageUrl(storagePath: string): string {
  return getSupabase().storage.from('vehitra-catalog-images').getPublicUrl(storagePath).data.publicUrl;
}

export class AccessError extends Error {
  reason: 'not_admin' | 'suspended';

  constructor(reason: 'not_admin' | 'suspended', message: string) {
    super(message);
    this.name = 'AccessError';
    this.reason = reason;
  }
}

interface QueryResponse {
  data: any;
  error: { message: string; code?: string } | null;
}

async function unwrap<T>(label: string, query: PromiseLike<QueryResponse>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return (data ?? []) as T;
}

function migrationHint(message: string): string | null {
  if (
    /could not find the function/i.test(message) ||
    /admin_members.*(does not exist|schema cache)/i.test(message) ||
    /admin_health.*(does not exist|schema cache)/i.test(message) ||
    /audit_events.*(does not exist|schema cache)/i.test(message)
  ) {
    return 'The admin console database migration has not been applied to this Supabase project. Apply supabase/migrations/20261026000100_admin_console.sql, then reload.';
  }
  return null;
}

function rpcMessage(error: { message: string; code?: string }): string {
  return migrationHint(error.message) ?? error.message;
}

function normalizeUnknownRule(value: unknown): UnknownHistoryRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const type = candidate.type;
  const numeric = Number(candidate.value);
  if ((type !== 'remaining_km' && type !== 'percent_used') || !Number.isFinite(numeric)) return null;
  return { type, value: numeric };
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw new Error(error.message);
  return data.session;
}

export function subscribeToAuth(callback: (session: Session | null) => void): () => void {
  if (!isSupabaseConfigured) return () => {};
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured) return;
  await getSupabase().auth.signOut();
}

export async function loadWorkspace(userId: string): Promise<WorkspaceBundle> {
  const client = getSupabase();

  const membership = await client
    .from('admin_members')
    .select('user_id,email,display_name,role,status,last_active_at,created_at,updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (membership.error) {
    const hint = migrationHint(membership.error.message);
    throw new Error(hint ?? `Administrator lookup failed: ${membership.error.message}`);
  }
  const member = membership.data as AdminMember | null;
  if (!member) {
    throw new AccessError('not_admin', 'This account is not an administrator. Ask a super admin to grant access.');
  }
  if (member.status !== 'active') {
    throw new AccessError('suspended', 'This administrator account is suspended. Contact a super admin.');
  }

  const touch = await client.rpc('admin_touch_session');
  if (touch.error) throw new Error(rpcMessage(touch.error));
  member.last_active_at = new Date().toISOString();

  const [rawModels, versions, components, rawRules, requests, admins, audit, health] = await Promise.all([
    unwrap<any[]>(
      'Vehicle models',
      client
        .from('vehicle_models')
        .select(
          'id,slug,name,is_generic,year_from,year_to,active,sort_order,current_version,image_asset_id,image:assets(storage_path),created_at,updated_at,brand:brands(id,slug,name),vehicle_type:vehicle_types(code,name)',
        )
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    ),
    unwrap<ModelVersion[]>('Catalog versions', client.from('model_versions').select('*').order('version', { ascending: false })),
    unwrap<ComponentDefinition[]>(
      'Component definitions',
      client.from('component_definitions').select('*').order('category', { ascending: true }).order('name', { ascending: true }),
    ),
    unwrap<any[]>('Maintenance rules', client.from('model_components').select('*,component:component_definitions(code,name,category)')),
    unwrap<ModelRequest[]>(
      'Model requests',
      client.from('model_requests').select('*').order('created_at', { ascending: false }).limit(1000),
    ),
    unwrap<AdminMember[]>('Administrators', client.from('admin_members').select('*').order('created_at', { ascending: true })),
    unwrap<AuditEvent[]>('Audit log', client.from('audit_events').select('*').order('created_at', { ascending: false }).limit(250)),
    unwrap<HealthSnapshot>('Health snapshot', client.rpc('admin_health')),
  ]);

  const models: CatalogModel[] = rawModels.map((row) => {
    const brand = firstRelation(row.brand);
    const type = firstRelation(row.vehicle_type);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      brand: brand ? { id: brand.id, slug: brand.slug, name: brand.name } : null,
      type: {
        code: (type?.code ?? 'other') as VehicleTypeCode,
        name: type?.name ?? 'Other',
      },
      is_generic: row.is_generic,
      year_from: row.year_from,
      year_to: row.year_to,
      active: row.active,
      sort_order: row.sort_order,
      current_version: row.current_version,
      image_storage_path: firstRelation(row.image)?.storage_path ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });

  const rules: ModelRule[] = rawRules.map((row) => {
    const component = firstRelation(row.component);
    return {
      model_id: row.model_id,
      component_id: row.component_id,
      version: row.version,
      interval_km: row.interval_km,
      interval_days: row.interval_days,
      warn_remaining_pct: Number(row.warn_remaining_pct ?? 25),
      unknown_history_rule: normalizeUnknownRule(row.unknown_history_rule),
      inactivity_rule: row.inactivity_rule,
      review_status: row.review_status as ReviewStatus,
      reviewed_by: row.reviewed_by,
      reviewed_at: row.reviewed_at,
      source_note: row.source_note,
      component: {
        code: component?.code ?? 'unknown',
        name: component?.name ?? 'Unknown component',
        category: component?.category ?? 'other',
      },
    };
  });

  return {
    member,
    workspace: {
      models,
      versions,
      components,
      rules,
      requests,
      admins,
      audit,
      health,
      loaded_at: new Date().toISOString(),
    },
  };
}

async function callRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw new Error(rpcMessage(error));
  return data as T;
}

export interface CreateModelInput {
  slug: string;
  name: string;
  brandSlug: string | null;
  typeCode: VehicleTypeCode;
  yearFrom: number | null;
  yearTo: number | null;
  sortOrder: number;
}

export interface UpdateModelInput {
  modelId: string;
  name: string;
  yearFrom: number | null;
  yearTo: number | null;
  active: boolean;
  sortOrder: number;
}

export interface SaveRuleInput {
  modelId: string;
  componentId: string;
  version: number;
  intervalKm: number | null;
  intervalDays: number | null;
  warnRemainingPct: number;
  unknownHistoryRule: UnknownHistoryRule | null;
  sourceNote: string | null;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
}

export const adminApi = {
  async uploadModelImage(modelId: string, file: File): Promise<void> {
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${modelId}/${crypto.randomUUID()}.${ext}`;
    const client = getSupabase();
    const { error: uploadError } = await client.storage.from('vehitra-catalog-images').upload(path, file, {
      contentType: file.type,
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);
    const { data: previousPath, error } = await client.rpc('admin_set_model_image', {
      p_model_id: modelId,
      p_storage_path: path,
      p_content_type: file.type,
      p_bytes: file.size,
    });
    if (error) throw new Error(error.message);
    if (previousPath) await client.storage.from('vehitra-catalog-images').remove([previousPath]);
  },
  async removeModelImage(modelId: string) {
    const { data: previousPath, error } = await getSupabase().rpc('admin_set_model_image', {
      p_model_id: modelId,
      p_storage_path: null,
      p_content_type: null,
      p_bytes: null,
    });
    if (error) throw new Error(error.message);
    if (previousPath) await getSupabase().storage.from('vehitra-catalog-images').remove([previousPath]);
  },
  createBrand(slug: string, name: string) {
    return callRpc<string>('admin_create_brand', { p_slug: slug, p_name: name });
  },
  createModel(input: CreateModelInput) {
    return callRpc<string>('admin_create_model', {
      p_slug: input.slug,
      p_name: input.name,
      p_brand_slug: input.brandSlug,
      p_type_code: input.typeCode,
      p_year_from: input.yearFrom,
      p_year_to: input.yearTo,
      p_sort_order: input.sortOrder,
    });
  },
  updateModel(input: UpdateModelInput) {
    return callRpc<void>('admin_update_model', {
      p_model_id: input.modelId,
      p_name: input.name,
      p_year_from: input.yearFrom,
      p_year_to: input.yearTo,
      p_active: input.active,
      p_sort_order: input.sortOrder,
    });
  },
  beginVersion(modelId: string) {
    return callRpc<number>('admin_begin_version', { p_model_id: modelId });
  },
  publishVersion(modelId: string, version: number) {
    return callRpc<void>('admin_publish_version', { p_model_id: modelId, p_version: version });
  },
  saveRule(input: SaveRuleInput) {
    return callRpc<void>('admin_save_rule', {
      p_model_id: input.modelId,
      p_component_id: input.componentId,
      p_version: input.version,
      p_interval_km: input.intervalKm,
      p_interval_days: input.intervalDays,
      p_warn_remaining_pct: input.warnRemainingPct,
      p_unknown_history_rule: input.unknownHistoryRule,
      p_source_note: input.sourceNote,
      p_review_status: input.reviewStatus,
      p_reviewed_by: input.reviewedBy,
    });
  },
  deleteRule(modelId: string, componentId: string, version: number) {
    return callRpc<void>('admin_delete_rule', {
      p_model_id: modelId,
      p_component_id: componentId,
      p_version: version,
    });
  },
  reviewRule(input: {
    modelId: string;
    componentId: string;
    version: number;
    reviewed: boolean;
    reviewedBy: string | null;
    sourceNote: string | null;
  }) {
    return callRpc<void>('admin_review_rule', {
      p_model_id: input.modelId,
      p_component_id: input.componentId,
      p_version: input.version,
      p_reviewed: input.reviewed,
      p_reviewed_by: input.reviewedBy,
      p_source_note: input.sourceNote,
    });
  },
  setRequestStatus(requestIds: string[], status: ModelRequest['status']) {
    return callRpc<number>('admin_set_request_status', {
      p_request_ids: requestIds,
      p_status: status,
    });
  },
  grantRole(email: string, displayName: string, role: AdminRole) {
    return callRpc<string>('admin_grant_role', {
      p_email: email,
      p_display_name: displayName,
      p_role: role,
    });
  },
  updateMember(userId: string, role: AdminRole, status: AdminStatus) {
    return callRpc<void>('admin_update_member', {
      p_user_id: userId,
      p_role: role,
      p_status: status,
    });
  },
};

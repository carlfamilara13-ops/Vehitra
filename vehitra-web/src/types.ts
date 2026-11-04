export type VehicleTypeCode = 'motorcycle' | 'car' | 'bicycle' | 'truck' | 'bus' | 'van' | 'other';

export const VEHICLE_TYPES: { code: VehicleTypeCode; label: string }[] = [
  { code: 'motorcycle', label: 'Motorcycle' },
  { code: 'car', label: 'Car' },
  { code: 'bicycle', label: 'Bicycle' },
  { code: 'truck', label: 'Truck' },
  { code: 'bus', label: 'Bus' },
  { code: 'van', label: 'Van' },
  { code: 'other', label: 'Other' },
];

export type AdminRole = 'super_admin' | 'catalog_admin' | 'support_admin';
export type AdminStatus = 'active' | 'suspended';
export type ReviewStatus = 'draft' | 'reviewed';
export type RequestStatus = 'new' | 'added' | 'rejected';
export type PageId =
  | 'overview'
  | 'catalog'
  | 'rules'
  | 'releases'
  | 'requests'
  | 'admins'
  | 'audit'
  | 'health'
  | 'settings';

export interface Brand {
  id: string;
  slug: string;
  name: string;
}

export interface VehicleType {
  code: VehicleTypeCode;
  name: string;
}

export interface CatalogModel {
  id: string;
  slug: string;
  name: string;
  brand: Brand | null;
  type: VehicleType;
  is_generic: boolean;
  year_from: number | null;
  year_to: number | null;
  active: boolean;
  sort_order: number;
  current_version: number;
  image_storage_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModelVersion {
  model_id: string;
  version: number;
  published: boolean;
  note: string | null;
  created_at: string;
}

export interface ComponentDefinition {
  id: string;
  code: string;
  name: string;
  category: string;
  allowed_actions: string[];
  applies_to_types: VehicleTypeCode[];
}

export interface UnknownHistoryRule {
  type: 'remaining_km' | 'percent_used';
  value: number;
}

export interface ModelRule {
  model_id: string;
  component_id: string;
  version: number;
  interval_km: number | null;
  interval_days: number | null;
  warn_remaining_pct: number;
  unknown_history_rule: UnknownHistoryRule | null;
  inactivity_rule: unknown | null;
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  source_note: string | null;
  component: {
    code: string;
    name: string;
    category: string;
  };
}

export interface ModelRequest {
  id: string;
  user_id: string;
  vehicle_type_code: VehicleTypeCode;
  brand_text: string | null;
  model_text: string;
  notes: string | null;
  status: RequestStatus;
  created_at: string;
}

export interface AdminMember {
  user_id: string;
  email: string;
  display_name: string;
  role: AdminRole;
  status: AdminStatus;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  id: number | string;
  actor_user_id: string | null;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: {
    old?: Record<string, unknown> | null;
    new?: Record<string, unknown> | null;
  };
  created_at: string;
}

export interface HealthSnapshot {
  database_time: string;
  models: number;
  active_models: number;
  archived_models: number;
  versions: number;
  draft_versions: number;
  rules: number;
  reviewed_rules: number;
  open_requests: number;
  admin_members: number;
  audit_events: number;
  role: AdminRole;
}

export interface Workspace {
  models: CatalogModel[];
  versions: ModelVersion[];
  components: ComponentDefinition[];
  rules: ModelRule[];
  requests: ModelRequest[];
  admins: AdminMember[];
  audit: AuditEvent[];
  health: HealthSnapshot;
  loaded_at: string;
}

export interface WorkspaceBundle {
  workspace: Workspace;
  member: AdminMember;
}

export interface ModelView {
  model: CatalogModel;
  current: ModelVersion | null;
  draft: ModelVersion | null;
  status: 'published' | 'draft' | 'archived';
  rule_count: number;
  reviewed_count: number;
  draft_rule_count: number;
  draft_reviewed_count: number;
}

export interface RequestGroup {
  key: string;
  type: VehicleTypeCode;
  brand: string | null;
  model: string;
  status: RequestStatus;
  count: number;
  latest: string;
  notes: string | null;
  ids: string[];
}

export interface SessionUser {
  id: string;
  email: string;
}

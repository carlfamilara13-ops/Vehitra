import type {
  AdminRole,
  AdminStatus,
  CatalogModel,
  ModelRule,
  ModelView,
  RequestStatus,
  VehicleTypeCode,
} from '../types';
import { VEHICLE_TYPES } from '../types';

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function vehicleTypeLabel(code: VehicleTypeCode | string): string {
  return VEHICLE_TYPES.find((type) => type.code === code)?.label ?? 'Other';
}

export function roleLabel(role: AdminRole | string): string {
  switch (role) {
    case 'super_admin':
      return 'Super admin';
    case 'catalog_admin':
      return 'Catalog admin';
    case 'support_admin':
      return 'Support admin';
    default:
      return String(role);
  }
}

export function statusLabel(status: AdminStatus | string): string {
  return status === 'active' ? 'Active' : 'Suspended';
}

export function requestStatusLabel(status: RequestStatus | string): string {
  switch (status) {
    case 'new':
      return 'New';
    case 'added':
      return 'Added';
    case 'rejected':
      return 'Rejected';
    default:
      return String(status);
  }
}

export function modelLabel(model: CatalogModel): string {
  if (model.brand) return `${model.brand.name} ${model.name}`;
  return model.name;
}

export function modelPrimaryName(model: CatalogModel): string {
  return model.brand ? model.brand.name : model.name;
}

export function modelSecondaryName(model: CatalogModel): string {
  return model.brand ? model.name : vehicleTypeLabel(model.type.code);
}

export function yearsLabel(from: number | null, to: number | null): string {
  if (from && to && from !== to) return `${from}–${to}`;
  if (from) return `${from}`;
  if (to) return `Up to ${to}`;
  return 'All years';
}

export function versionLabel(version: { version: number; published: boolean } | null): string {
  if (!version) return 'No version';
  return `v${version.version}${version.published ? '' : ' · draft'}`;
}

export function intervalLabel(rule: ModelRule): string {
  const parts: string[] = [];
  if (rule.interval_km != null) parts.push(`Every ${formatNumber(rule.interval_km)} km`);
  if (rule.interval_days != null) parts.push(`or ${formatNumber(rule.interval_days)} days`);
  if (!parts.length) return 'Interval not set';
  return parts.join(' ');
}

export function unknownHistoryLabel(rule: ModelRule): string {
  if (!rule.unknown_history_rule) return 'Not set';
  const value = rule.unknown_history_rule.value;
  return rule.unknown_history_rule.type === 'remaining_km'
    ? `${formatNumber(value)} km remaining`
    : `${formatNumber(value)}% used`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return 'Just now';
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return relativeFormatter.format(Math.round(diffSeconds / 3600), 'hour');
  if (abs < 86400 * 30) return relativeFormatter.format(Math.round(diffSeconds / 86400), 'day');
  return formatDate(value);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return `${parts[0][0] ?? ''}${parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''}`.toUpperCase();
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function reviewPercent(view: ModelView): number {
  if (!view.rule_count) return 0;
  return Math.round((view.reviewed_count / view.rule_count) * 100);
}

export function auditActionLabel(action: string): string {
  const [table, operation] = action.split('.');
  const key = `${table}.${operation}`;
  const labels: Record<string, string> = {
    'vehicle_models.insert': 'Vehicle model created',
    'vehicle_models.update': 'Vehicle model updated',
    'vehicle_models.delete': 'Vehicle model deleted',
    'model_versions.insert': 'Catalog version prepared',
    'model_versions.update': 'Catalog version updated',
    'model_versions.delete': 'Catalog version removed',
    'model_components.insert': 'Maintenance rule added',
    'model_components.update': 'Maintenance rule updated',
    'model_components.delete': 'Maintenance rule removed',
    'model_requests.update': 'Model request updated',
    'admin_members.insert': 'Administrator granted',
    'admin_members.update': 'Administrator updated',
    'admin_members.delete': 'Administrator removed',
  };
  return labels[key] ?? `${table} ${operation}`;
}

export function auditTargetLabel(event: {
  target_type: string;
  target_id: string | null;
  detail: { old?: Record<string, unknown> | null; new?: Record<string, unknown> | null };
}): string {
  const row = event.detail.new ?? event.detail.old ?? {};
  const preferred = row['display_name'] ?? row['name'] ?? row['model_text'] ?? row['email'] ?? row['slug'];
  if (typeof preferred === 'string' && preferred.trim()) return preferred;
  return event.target_id ?? event.target_type;
}

export function actionKind(action: string): 'created' | 'updated' | 'removed' | 'other' {
  if (action.endsWith('.insert')) return 'created';
  if (action.endsWith('.update')) return 'updated';
  if (action.endsWith('.delete')) return 'removed';
  return 'other';
}

export function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const content = [headers.map(csvEscape).join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\r\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function requestGroupKey(request: {
  vehicle_type_code: string;
  brand_text: string | null;
  model_text: string;
  status: string;
}): string {
  const brand = (request.brand_text ?? '').trim().toLowerCase();
  const model = request.model_text.trim().toLowerCase();
  return [request.vehicle_type_code, brand, model, request.status].join('::');
}

export function friendlyError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Something went wrong. Please try again.';
}

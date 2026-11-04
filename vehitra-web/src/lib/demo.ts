import type {
  AdminMember,
  AuditEvent,
  CatalogModel,
  ComponentDefinition,
  ModelRequest,
  ModelRule,
  ModelVersion,
  UnknownHistoryRule,
  VehicleTypeCode,
  Workspace,
} from '../types';
import { slugify } from './format';

type RuleSpec = {
  code: string;
  km: number | null;
  days?: number | null;
  reviewed?: boolean;
  source: string;
  unknownRule?: UnknownHistoryRule | null;
};

type ModelSpec = {
  slug: string;
  brand: string | null;
  name: string;
  type: VehicleTypeCode;
  from: number | null;
  to: number | null;
  published: boolean;
  active?: boolean;
  draft?: RuleSpec[];
  rules: RuleSpec[];
};

const components: ComponentDefinition[] = [
  ['engine_oil', 'Engine Oil', 'engine', ['replace'], ['motorcycle', 'car', 'truck', 'bus', 'van', 'other']],
  ['oil_filter', 'Oil Filter', 'engine', ['replace'], ['car', 'truck', 'bus', 'van', 'other']],
  ['air_filter', 'Air Filter', 'engine', ['clean', 'replace'], ['motorcycle', 'car', 'truck', 'bus', 'van', 'other']],
  ['spark_plug', 'Spark Plug', 'engine', ['inspect', 'replace'], ['motorcycle', 'car', 'other']],
  ['coolant', 'Coolant', 'fluids', ['inspect', 'replace'], ['motorcycle', 'car', 'truck', 'bus', 'van', 'other']],
  ['front_brake_pads', 'Front Brake Pads', 'brakes', ['inspect', 'replace'], ['motorcycle', 'car', 'bicycle', 'truck', 'bus', 'van', 'other']],
  ['rear_brake_pads', 'Rear Brake Pads', 'brakes', ['inspect', 'replace'], ['motorcycle', 'car', 'bicycle', 'truck', 'bus', 'van', 'other']],
  ['brake_fluid', 'Brake Fluid', 'fluids', ['replace'], ['motorcycle', 'car', 'truck', 'bus', 'van', 'other']],
  ['front_tire', 'Front Tire', 'wheels_tires', ['inspect', 'replace'], ['motorcycle', 'car', 'bicycle', 'truck', 'bus', 'van', 'other']],
  ['rear_tire', 'Rear Tire', 'wheels_tires', ['inspect', 'replace'], ['motorcycle', 'car', 'bicycle', 'truck', 'bus', 'van', 'other']],
  ['battery', 'Battery', 'electrical', ['inspect', 'replace'], ['motorcycle', 'car', 'truck', 'bus', 'van', 'other']],
  ['drive_chain', 'Drive Chain', 'transmission', ['clean', 'lubricate', 'replace'], ['motorcycle', 'bicycle', 'other']],
  ['gear_oil', 'Gear Oil', 'fluids', ['replace'], ['motorcycle', 'other']],
  ['cvt_belt', 'CVT Belt', 'transmission', ['inspect', 'replace'], ['motorcycle']],
  ['transmission_fluid', 'Transmission Fluid', 'fluids', ['replace'], ['car', 'truck', 'bus', 'van', 'other']],
].map(([code, name, category, actions, applies]) => ({
  id: `demo-component-${code}`,
  code: code as string,
  name: name as string,
  category: category as string,
  allowed_actions: actions as string[],
  applies_to_types: applies as VehicleTypeCode[],
}));

const typeNames: Record<VehicleTypeCode, string> = {
  motorcycle: 'Motorcycle',
  car: 'Car',
  bicycle: 'Bicycle',
  truck: 'Truck',
  bus: 'Bus',
  van: 'Van',
  other: 'Other',
};

const specs: ModelSpec[] = [
  {
    slug: 'yamaha-sniper-155',
    brand: 'Yamaha',
    name: 'Sniper 155',
    type: 'motorcycle',
    from: 2024,
    to: 2026,
    published: true,
    rules: [
      { code: 'engine_oil', km: 1500, reviewed: true, source: 'Owner manual · page 6-3', unknownRule: { type: 'remaining_km', value: 750 } },
      { code: 'air_filter', km: null, source: 'Interval not set: pending review.' },
      { code: 'front_brake_pads', km: null, source: 'Interval not set: pending review.' },
      { code: 'rear_brake_pads', km: null, source: 'Interval not set: pending review.' },
      { code: 'drive_chain', km: null, source: 'Interval not set: pending review.' },
    ],
    draft: [
      { code: 'engine_oil', km: 3000, source: 'Updated interval from service bulletin review.' },
      { code: 'air_filter', km: 4000, source: 'Proposed interval, awaiting a second reviewer.' },
      { code: 'front_brake_pads', km: null, source: 'Interval not set: pending review.' },
      { code: 'rear_brake_pads', km: null, source: 'Interval not set: pending review.' },
      { code: 'drive_chain', km: null, source: 'Interval not set: pending review.' },
    ],
  },
  {
    slug: 'honda-click-125',
    brand: 'Honda',
    name: 'Click 125',
    type: 'motorcycle',
    from: 2023,
    to: 2026,
    published: true,
    rules: [
      { code: 'engine_oil', km: 1500, reviewed: true, source: 'Project spec default. Unverified.', unknownRule: { type: 'remaining_km', value: 750 } },
      { code: 'air_filter', km: null, source: 'Interval not set: pending review.' },
      { code: 'spark_plug', km: null, source: 'Interval not set: pending review.' },
      { code: 'cvt_belt', km: null, source: 'Interval not set: pending review.' },
      { code: 'gear_oil', km: null, source: 'Interval not set: pending review.' },
    ],
  },
  {
    slug: 'toyota-vios',
    brand: 'Toyota',
    name: 'Vios',
    type: 'car',
    from: 2022,
    to: 2026,
    published: true,
    rules: [
      { code: 'engine_oil', km: null, source: 'Interval not set: pending review.' },
      { code: 'oil_filter', km: null, source: 'Interval not set: pending review.' },
      { code: 'brake_fluid', km: null, source: 'Interval not set: pending review.' },
      { code: 'transmission_fluid', km: null, source: 'Interval not set: pending review.' },
    ],
  },
  {
    slug: 'suzuki-raider-r150',
    brand: 'Suzuki',
    name: 'Raider R150',
    type: 'motorcycle',
    from: 2023,
    to: 2026,
    published: false,
    rules: [
      { code: 'engine_oil', km: 3000, source: 'Draft recommendation awaiting a source.' },
      { code: 'spark_plug', km: null, source: 'Interval not set: pending review.' },
      { code: 'drive_chain', km: null, source: 'Interval not set: pending review.' },
    ],
  },
  {
    slug: 'generic-motorcycle',
    brand: null,
    name: 'Other motorcycle',
    type: 'motorcycle',
    from: null,
    to: null,
    published: true,
    rules: [
      { code: 'engine_oil', km: null, source: 'Generic safety baseline only.' },
      { code: 'front_tire', km: null, source: 'Inspect before each ride.' },
      { code: 'battery', km: null, source: 'Interval not set: pending review.' },
    ],
  },
  {
    slug: 'honda-tmx-125',
    brand: 'Honda',
    name: 'TMX 125',
    type: 'motorcycle',
    from: 2020,
    to: 2026,
    published: false,
    rules: [
      { code: 'engine_oil', km: 1500, source: 'Project spec default. Unverified.' },
      { code: 'drive_chain', km: null, source: 'Interval not set: pending review.' },
    ],
  },
  {
    slug: 'toyota-wigo',
    brand: 'Toyota',
    name: 'Wigo',
    type: 'car',
    from: 2023,
    to: 2026,
    published: true,
    rules: [
      { code: 'engine_oil', km: null, source: 'Interval not set: pending review.' },
      { code: 'air_filter', km: null, source: 'Interval not set: pending review.' },
      { code: 'front_brake_pads', km: null, source: 'Interval not set: pending review.' },
      { code: 'battery', km: null, source: 'Interval not set: pending review.' },
    ],
  },
  {
    slug: 'kawasaki-ninja-400',
    brand: 'Kawasaki',
    name: 'Ninja 400',
    type: 'motorcycle',
    from: 2023,
    to: 2026,
    published: true,
    rules: [
      { code: 'engine_oil', km: 6000, reviewed: true, source: 'Owner manual · maintenance table', unknownRule: { type: 'remaining_km', value: 1000 } },
      { code: 'oil_filter', km: 6000, reviewed: true, source: 'Owner manual · maintenance table' },
      { code: 'front_brake_pads', km: null, source: 'Interval not set: pending review.' },
      { code: 'coolant', km: null, source: 'Interval not set: pending review.' },
    ],
  },
  {
    slug: 'honda-beat',
    brand: 'Honda',
    name: 'Beat',
    type: 'motorcycle',
    from: 2020,
    to: 2026,
    published: true,
    active: false,
    rules: [{ code: 'engine_oil', km: 1500, reviewed: true, source: 'Archived model reference.' }],
  },
];

const brandIds = new Map<string, string>();
const now = Date.now();
const iso = (hoursAgo: number) => new Date(now - hoursAgo * 60 * 60 * 1000).toISOString();

function ruleFromSpec(
  spec: RuleSpec,
  modelId: string,
  version: number,
  index: number,
  forceDraft = false,
): ModelRule {
  const component = components.find((item) => item.code === spec.code) ?? components[0];
  const reviewed = spec.reviewed === true && !forceDraft;
  return {
    model_id: modelId,
    component_id: component.id,
    version,
    interval_km: spec.km,
    interval_days: spec.days ?? null,
    warn_remaining_pct: 25,
    unknown_history_rule: spec.unknownRule ?? null,
    inactivity_rule: null,
    review_status: reviewed ? 'reviewed' : 'draft',
    reviewed_by: reviewed ? 'Demo reviewer' : null,
    reviewed_at: reviewed ? iso(72 + index) : null,
    source_note: spec.source,
    component: {
      code: component.code,
      name: component.name,
      category: component.category,
    },
  };
}

function build(): Workspace {
  const models: CatalogModel[] = [];
  const versions: ModelVersion[] = [];
  const rules: ModelRule[] = [];

  for (const spec of specs) {
    const modelId = `demo-model-${spec.slug}`;
    let brand: CatalogModel['brand'] = null;
    if (spec.brand) {
      const brandId = brandIds.get(spec.brand) ?? `demo-brand-${slugify(spec.brand)}`;
      brandIds.set(spec.brand, brandId);
      brand = { id: brandId, slug: slugify(spec.brand), name: spec.brand };
    }
    const currentVersion = spec.published ? 1 : 1;
    models.push({
      id: modelId,
      slug: spec.slug,
      name: spec.name,
      brand,
      type: { code: spec.type, name: typeNames[spec.type] },
      is_generic: spec.brand === null,
      year_from: spec.from,
      year_to: spec.to,
      active: spec.active !== false,
      sort_order: spec.slug === 'yamaha-sniper-155' ? 1 : 100,
      current_version: currentVersion,
      image_storage_path: null,
      created_at: iso(24 * 60),
      updated_at: iso(24 * 6),
    });
    versions.push({
      model_id: modelId,
      version: 1,
      published: spec.published,
      note: spec.published ? 'Initial reviewed catalog release.' : 'Draft catalog entry.',
      created_at: iso(24 * 30),
    });
    spec.rules.forEach((rule, index) => rules.push(ruleFromSpec(rule, modelId, 1, index)));

    if (spec.draft) {
      versions.push({
        model_id: modelId,
        version: 2,
        published: false,
        note: 'Draft revision prepared in the admin console.',
        created_at: iso(5),
      });
      spec.draft.forEach((rule, index) => rules.push(ruleFromSpec(rule, modelId, 2, index, true)));
    }
  }

  const requests: ModelRequest[] = [
    ['Honda', 'ADV 160', 'motorcycle', 'new', 6, 'Requested by several riders in Metro Manila.'],
    ['Honda', 'ADV 160', 'motorcycle', 'new', 26, 'Same model, second submission.'],
    ['Honda', 'ADV 160', 'motorcycle', 'new', 33, null],
    ['Kawasaki', 'Ninja 400', 'motorcycle', 'new', 31, '2024–2026 model years please.'],
    ['Kawasaki', 'Ninja 400', 'motorcycle', 'new', 48, null],
    ['Isuzu', 'Traviz', 'truck', 'added', 74, 'Added as a draft catalog entry.'],
    ['Toyota', 'HiAce', 'van', 'rejected', 96, 'Duplicate request.'],
  ].map(([brand, model, type, status, hours, notes], index) => ({
    id: `demo-request-${index + 1}`,
    user_id: `demo-user-${index + 1}`,
    vehicle_type_code: type as VehicleTypeCode,
    brand_text: brand as string,
    model_text: model as string,
    notes: notes as string | null,
    status: status as ModelRequest['status'],
    created_at: iso(hours as number),
  }));

  const admins: AdminMember[] = [
    {
      user_id: 'demo-admin-1',
      email: 'alex@vehitra.app',
      display_name: 'Alex Morgan',
      role: 'super_admin',
      status: 'active',
      last_active_at: iso(0),
      created_at: iso(24 * 120),
      updated_at: iso(24 * 3),
    },
    {
      user_id: 'demo-admin-2',
      email: 'jamie@vehitra.app',
      display_name: 'Jamie Santos',
      role: 'catalog_admin',
      status: 'active',
      last_active_at: iso(2),
      created_at: iso(24 * 90),
      updated_at: iso(24 * 9),
    },
    {
      user_id: 'demo-admin-3',
      email: 'taylor@vehitra.app',
      display_name: 'Taylor Reyes',
      role: 'support_admin',
      status: 'suspended',
      last_active_at: iso(24 * 4),
      created_at: iso(24 * 30),
      updated_at: iso(24 * 4),
    },
  ];

  const audit: AuditEvent[] = [
    {
      id: 4,
      actor_user_id: 'demo-admin-2',
      actor_email: 'jamie@vehitra.app',
      action: 'model_components.update',
      target_type: 'model_components',
      target_id: 'demo-model-yamaha-sniper-155 v2',
      detail: { new: { component: 'Engine Oil', interval_km: 3000, review_status: 'draft' } },
      created_at: iso(1),
    },
    {
      id: 3,
      actor_user_id: 'demo-admin-1',
      actor_email: 'alex@vehitra.app',
      action: 'model_versions.update',
      target_type: 'model_versions',
      target_id: 'demo-model-kawasaki-ninja-400 v1',
      detail: { new: { published: true, note: 'Initial reviewed catalog release.' } },
      created_at: iso(4),
    },
    {
      id: 2,
      actor_user_id: 'demo-admin-1',
      actor_email: 'alex@vehitra.app',
      action: 'admin_members.insert',
      target_type: 'admin_members',
      target_id: 'demo-admin-3',
      detail: { new: { display_name: 'Taylor Reyes', role: 'support_admin' } },
      created_at: iso(20),
    },
    {
      id: 1,
      actor_user_id: 'demo-admin-2',
      actor_email: 'jamie@vehitra.app',
      action: 'model_requests.update',
      target_type: 'model_requests',
      target_id: 'demo-request-6',
      detail: { old: { status: 'new' }, new: { status: 'added' } },
      created_at: iso(30),
    },
  ];

  const reviewed = rules.filter((rule) => rule.review_status === 'reviewed').length;
  const open = requests.filter((request) => request.status === 'new').length;

  return {
    models,
    versions,
    components,
    rules,
    requests,
    admins,
    audit,
    health: {
      database_time: new Date().toISOString(),
      models: models.length,
      active_models: models.filter((model) => model.active).length,
      archived_models: models.filter((model) => !model.active).length,
      versions: versions.length,
      draft_versions: versions.filter((version) => !version.published).length,
      rules: rules.length,
      reviewed_rules: reviewed,
      open_requests: open,
      admin_members: admins.filter((admin) => admin.status === 'active').length,
      audit_events: audit.length,
      role: 'super_admin',
    },
    loaded_at: new Date().toISOString(),
  };
}

export const demoWorkspace: Workspace = build();

export const demoMember: AdminMember = demoWorkspace.admins[0];

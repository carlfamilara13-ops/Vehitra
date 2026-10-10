-- Step 3a: user-owned tables.
-- Ownership is enforced twice: RLS (user_id = auth.uid()) AND composite foreign keys, so a child row can
-- only point at a user_vehicle / ride / entry that belongs to the SAME user_id.

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  units text not null default 'metric' check (units in ('metric','imperial')),
  ui_mode text not null default 'standard' check (ui_mode in ('dynamic','standard','easy')),
  notification_prefs jsonb not null default '{}'::jsonb,
  -- Local raw-GPS retention (days). -1 = keep forever. The cloud never stores raw points.
  raw_retention_days int not null default 30 check (raw_retention_days = -1 or raw_retention_days between 1 and 3650),
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  model_id uuid not null,
  catalog_version int not null,           -- snapshot: exact rules this vehicle reads
  custom_label text check (char_length(custom_label) <= 80),
  nickname text check (char_length(nickname) <= 60),
  plate text check (char_length(plate) <= 20),
  model_year smallint check (model_year is null or model_year between 1885 and 2100),
  registration_expiry date,
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (model_id, catalog_version) references public.model_versions(model_id, version) on delete restrict
);
create index user_vehicles_user_idx on public.user_vehicles (user_id) where deleted_at is null;

-- A vehicle may only snapshot a PUBLISHED catalog version, and cannot switch model (V1).
create or replace function public.guard_user_vehicles()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.model_id <> old.model_id then
    raise exception 'a vehicle cannot change model' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'INSERT' or new.catalog_version <> old.catalog_version then
    if not exists (select 1 from public.model_versions
                    where model_id = new.model_id and version = new.catalog_version and published) then
      raise exception 'catalog version is not published' using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end $$;
create trigger user_vehicles_guard before insert or update on public.user_vehicles
  for each row execute function public.guard_user_vehicles();

create table public.rides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_vehicle_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  status text not null check (status in ('finished','recovered')),
  gps_distance_m double precision not null check (gps_distance_m >= 0),  -- authoritative; never recomputed from the polyline
  duration_s int check (duration_s is null or duration_s >= 0),
  avg_speed_ms real check (avg_speed_ms is null or avg_speed_ms >= 0),
  max_speed_ms real check (max_speed_ms is null or max_speed_ms >= 0),
  untracked_gap_s int not null default 0 check (untracked_gap_s >= 0),
  untracked_gap_m real not null default 0 check (untracked_gap_m >= 0),
  point_count int check (point_count is null or point_count >= 0),
  polyline text,                          -- simplified encoded route; syncs independently of raw points
  polyline_precision smallint not null default 5,
  polyline_tolerance_m real check (polyline_tolerance_m is null or polyline_tolerance_m >= 0),
  needs_review boolean not null default false,
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  check (ended_at >= started_at),
  foreign key (user_vehicle_id, user_id) references public.user_vehicles(id, user_id)
);
create index rides_vehicle_idx on public.rides (user_vehicle_id, started_at desc);

-- Mileage ledger (insert-only). See docs/ARCHITECTURE_NOTES.md section 5.
create table public.mileage_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_vehicle_id uuid not null,
  kind text not null check (kind in ('initial','ride','dashboard_reading','adjustment','odometer_replacement','void')),
  source text not null check (source in ('gps','dashboard_reading','manual_adjustment','estimated','initial')),
  ride_id uuid,
  gps_distance_m double precision check (gps_distance_m is null or gps_distance_m >= 0),
  suggested_km numeric(12,3) check (suggested_km is null or suggested_km >= 0),
  applied_km numeric(12,3) not null default 0 check (applied_km >= 0),   -- counts toward maintenance
  odo_reading_after numeric(12,3) check (odo_reading_after is null or odo_reading_after >= 0), -- running odometer; NULL only on void rows (recomputed by replay)
  odo_offset_delta numeric(12,3) not null default 0,   -- non-zero ONLY on odometer_replacement: E - R at entry time
  flags text[] not null default '{}' check (flags <@ array['calibration','large_jump','rollover','reading_lowered','needs_review']::text[]),
  voids_entry_id uuid,
  note text check (char_length(note) <= 500),
  client_created_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_vehicle_id, user_id),
  foreign key (user_vehicle_id, user_id) references public.user_vehicles(id, user_id),
  foreign key (ride_id, user_id) references public.rides(id, user_id),
  -- a void must reference an entry of the SAME vehicle and user
  foreign key (voids_entry_id, user_vehicle_id, user_id) references public.mileage_entries(id, user_vehicle_id, user_id),
  check ((kind = 'void') = (voids_entry_id is not null)),
  check ((kind = 'void') = (odo_reading_after is null)),
  check (kind <> 'void' or (applied_km = 0 and odo_offset_delta = 0)),
  check (kind <> 'ride' or (source = 'gps' and ride_id is not null)),
  check (kind = 'ride' or ride_id is null),
  check (kind <> 'dashboard_reading' or source = 'dashboard_reading'),
  check (kind <> 'initial' or (source = 'initial' and applied_km = 0)),
  check (kind <> 'odometer_replacement' or (source = 'manual_adjustment' and applied_km = 0)),
  check (kind = 'odometer_replacement' or odo_offset_delta = 0),
  check (kind <> 'adjustment' or source in ('manual_adjustment','estimated')),
  -- Any reading that adds no distance (equal or LOWER) must carry a flag, so it shows up for review.
  check (kind <> 'dashboard_reading' or applied_km > 0 or cardinality(flags) > 0)
);
create index mileage_entries_vehicle_idx on public.mileage_entries (user_vehicle_id, client_created_at, id);
create trigger mileage_entries_immutable before update or delete on public.mileage_entries
  for each row execute function public.forbid_modification();

create table public.service_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_vehicle_id uuid not null,
  component_id uuid not null references public.component_definitions(id),  -- catalog component; no per-user component row needed
  action text not null check (action in ('replace','clean','lubricate','inspect','service','baseline','void')),
  performed_at timestamptz not null,
  odo_at numeric(12,3) check (odo_at is null or odo_at >= 0),
  estimated boolean not null default false,
  voids_event_id uuid,
  notes text check (char_length(notes) <= 500),
  client_created_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_vehicle_id, component_id, user_id),
  foreign key (user_vehicle_id, user_id) references public.user_vehicles(id, user_id),
  foreign key (voids_event_id, user_vehicle_id, component_id, user_id)
    references public.service_events(id, user_vehicle_id, component_id, user_id),
  check ((action = 'void') = (voids_event_id is not null)),
  check (action <> 'baseline' or estimated)   -- estimated baseline events are always labelled estimated
);
create index service_events_vehicle_idx on public.service_events (user_vehicle_id, component_id, performed_at);
create trigger service_events_immutable before update or delete on public.service_events
  for each row execute function public.forbid_modification();

create table public.part_installs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_vehicle_id uuid not null,
  component_id uuid not null references public.component_definitions(id),
  brand text check (char_length(brand) <= 80),
  model text check (char_length(model) <= 80),
  installed_at timestamptz not null,
  install_odo numeric(12,3) check (install_odo is null or install_odo >= 0),
  removed_at timestamptz,
  removal_odo numeric(12,3) check (removal_odo is null or removal_odo >= 0),
  notes text check (char_length(notes) <= 500),
  close_notes text check (char_length(close_notes) <= 500),
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (user_vehicle_id, user_id) references public.user_vehicles(id, user_id),
  check (removed_at is null or removed_at >= installed_at),
  check (removal_odo is null or removed_at is not null)
);
-- Only ONE current (open) install per component per vehicle.
create unique index part_installs_one_open on public.part_installs (user_vehicle_id, component_id) where removed_at is null;

-- Closed installs are history: immutable. Open installs can be corrected (descriptive fields) or closed.
create or replace function public.guard_part_installs()
returns trigger language plpgsql as $$
begin
  if old.removed_at is not null then
    raise exception 'closed part installs are history and cannot be modified' using errcode = 'restrict_violation';
  end if;
  if (new.id, new.user_id, new.user_vehicle_id, new.component_id, new.created_at)
     is distinct from (old.id, old.user_id, old.user_vehicle_id, old.component_id, old.created_at) then
    raise exception 'part install identity cannot change' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
create trigger part_installs_guard before update on public.part_installs
  for each row execute function public.guard_part_installs();
create trigger part_installs_no_delete before delete on public.part_installs
  for each row execute function public.forbid_delete();

create table public.component_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_vehicle_id uuid not null,
  component_id uuid not null references public.component_definitions(id),
  interval_km int check (interval_km is null or interval_km > 0),
  interval_days int check (interval_days is null or interval_days > 0),
  enabled boolean not null default true,
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_vehicle_id, component_id),
  foreign key (user_vehicle_id, user_id) references public.user_vehicles(id, user_id)
);

create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_vehicle_id uuid,
  kind text not null check (kind in ('registration','license','insurance','inspection','custom')),
  label text check (char_length(label) <= 80),
  due_date date not null,
  reminder_offsets_days int[] not null default '{30,7,3,0}' check (array_position(reminder_offsets_days, null) is null and reminder_offsets_days <@ array[0,1,2,3,5,7,14,30,60,90]::int[]),
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (user_vehicle_id, user_id) references public.user_vehicles(id, user_id),
  check (kind in ('license','custom') or user_vehicle_id is not null)
);

create table public.model_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vehicle_type_code text not null check (vehicle_type_code in ('motorcycle','car','bicycle','truck','bus','van','other')),
  brand_text text check (char_length(brand_text) <= 80),
  model_text text not null check (char_length(model_text) between 1 and 80),
  notes text check (char_length(notes) <= 500),
  status text not null default 'new' check (status in ('new','added','rejected')),
  created_at timestamptz not null default now()
);

-- updated_at maintenance
create trigger user_settings_updated before update on public.user_settings for each row execute function public.set_updated_at();
create trigger user_vehicles_updated before update on public.user_vehicles for each row execute function public.set_updated_at();
create trigger rides_updated before update on public.rides for each row execute function public.set_updated_at();
create trigger part_installs_updated before update on public.part_installs for each row execute function public.set_updated_at();
create trigger component_overrides_updated before update on public.component_overrides for each row execute function public.set_updated_at();
create trigger deadlines_updated before update on public.deadlines for each row execute function public.set_updated_at();

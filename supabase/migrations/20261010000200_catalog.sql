-- Step 3a: shared catalog (read-only for users). Versioned and immutable once published.

create table public.vehicle_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('motorcycle','car','bicycle','truck','bus','van','other')),
  name text not null,
  sort_order int not null default 0
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('vehicle_image')),
  storage_path text not null unique,
  content_type text,
  bytes int check (bytes is null or bytes > 0)
);

create table public.component_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null check (category in ('engine','brakes','wheels_tires','electrical','transmission','fluids','body','other')),
  allowed_actions text[] not null check (
    cardinality(allowed_actions) > 0
    and allowed_actions <@ array['replace','clean','lubricate','inspect','service']::text[]),
  applies_to_types text[] not null check (
    cardinality(applies_to_types) > 0
    and applies_to_types <@ array['motorcycle','car','bicycle','truck','bus','van','other']::text[])
);

create table public.vehicle_models (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id),
  type_id uuid not null references public.vehicle_types(id),
  slug text not null unique,
  name text not null,
  is_generic boolean not null default false,
  year_from int check (year_from is null or year_from between 1885 and 2100),
  year_to int check (year_to is null or year_to between 1885 and 2100),
  image_asset_id uuid references public.assets(id),
  sort_order int not null default 100,
  current_version int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, type_id, name),
  check (is_generic = (brand_id is null)),
  check (year_to is null or year_from is null or year_to >= year_from)
);

-- One row per (model, version). A version is invisible to users until published.
create table public.model_versions (
  model_id uuid not null references public.vehicle_models(id) on delete restrict,
  version int not null check (version >= 1),
  published boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  primary key (model_id, version)
);

-- current_version must point at a real version row (deferred: model and version 1 are created together).
alter table public.vehicle_models
  add constraint vehicle_models_current_version_fk
  foreign key (id, current_version) references public.model_versions(model_id, version)
  deferrable initially deferred;

create table public.model_components (
  model_id uuid not null,
  component_id uuid not null references public.component_definitions(id),
  version int not null,
  interval_km int check (interval_km is null or interval_km > 0),
  interval_days int check (interval_days is null or interval_days > 0),
  warn_remaining_pct numeric(5,2) not null default 25 check (warn_remaining_pct between 0 and 100),
  unknown_history_rule jsonb check (
    unknown_history_rule is null or (
      unknown_history_rule ->> 'type' in ('remaining_km','percent_used')
      and (unknown_history_rule ->> 'value') ~ '^[0-9]+(\.[0-9]+)?$')),
  inactivity_rule jsonb,
  review_status text not null default 'draft' check (review_status in ('draft','reviewed')),
  reviewed_by text,
  reviewed_at timestamptz,
  source_note text,
  primary key (model_id, component_id, version),
  foreign key (model_id, version) references public.model_versions(model_id, version) on delete restrict,
  -- A value can only be called "reviewed" with a named reviewer and date.
  check (review_status = 'draft' or (reviewed_by is not null and reviewed_at is not null))
);

-- model_versions: only the publish transition (false -> true) may update; only unpublished versions may be deleted.
create or replace function public.guard_model_versions()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.published then
      raise exception 'published catalog version %/% cannot be deleted', old.model_id, old.version
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;
  if old.published then
    raise exception 'published catalog version %/% cannot be modified', old.model_id, old.version
      using errcode = 'restrict_violation';
  end if;
  if new.model_id <> old.model_id or new.version <> old.version then
    raise exception 'catalog version identity cannot change' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger model_versions_guard
  before update or delete on public.model_versions
  for each row execute function public.guard_model_versions();

-- model_components: rows of a published version are frozen, except the review columns
-- (marking a value "reviewed" does not change any number an existing vehicle uses).
create or replace function public.guard_model_components()
returns trigger language plpgsql as $$
declare v_published boolean;
begin
  select published into v_published from public.model_versions
   where model_id = old.model_id and version = old.version;
  if coalesce(v_published, false) then
    if tg_op = 'DELETE' then
      raise exception 'rows of a published catalog version cannot be deleted' using errcode = 'restrict_violation';
    end if;
    if (new.model_id, new.component_id, new.version, new.interval_km, new.interval_days,
        new.warn_remaining_pct, new.unknown_history_rule, new.inactivity_rule)
       is distinct from
       (old.model_id, old.component_id, old.version, old.interval_km, old.interval_days,
        old.warn_remaining_pct, old.unknown_history_rule, old.inactivity_rule) then
      raise exception 'rule values of a published catalog version cannot change; create a new version'
        using errcode = 'restrict_violation';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger model_components_guard
  before update or delete on public.model_components
  for each row execute function public.guard_model_components();

-- A model's current_version must be a published version.
create or replace function public.guard_vehicle_models_version()
returns trigger language plpgsql as $$
begin
  if new.current_version is distinct from old.current_version then
    if not exists (select 1 from public.model_versions
                    where model_id = new.id and version = new.current_version and published) then
      raise exception 'current_version must be a published version' using errcode = 'restrict_violation';
    end if;
  end if;
  new.updated_at = now();
  return new;
end $$;

create trigger vehicle_models_guard
  before update on public.vehicle_models
  for each row execute function public.guard_vehicle_models_version();

-- Admin workflow (service role / SQL editor only; see grants migration):
--   1. catalog_begin_version(model) copies the current rules into a new UNPUBLISHED version (as draft).
--   2. Edit the new version's rows freely.
--   3. catalog_publish_version(model, version) publishes it and makes it current.
-- Users keep their snapshot until they accept the new version.
create or replace function public.catalog_begin_version(p_model_id uuid)
returns int language plpgsql set search_path = public as $$
declare v_cur int; v_new int;
begin
  select current_version into v_cur from vehicle_models where id = p_model_id;
  if v_cur is null then raise exception 'unknown model'; end if;
  select max(version) + 1 into v_new from model_versions where model_id = p_model_id;
  insert into model_versions (model_id, version, published, note)
    values (p_model_id, v_new, false, 'copied from v' || v_cur);
  insert into model_components (model_id, component_id, version, interval_km, interval_days,
                                warn_remaining_pct, unknown_history_rule, inactivity_rule,
                                review_status, source_note)
    select model_id, component_id, v_new, interval_km, interval_days,
           warn_remaining_pct, unknown_history_rule, inactivity_rule,
           'draft', 'copied from v' || v_cur || '; needs review'
      from model_components where model_id = p_model_id and version = v_cur;
  return v_new;
end $$;

create or replace function public.catalog_publish_version(p_model_id uuid, p_version int)
returns void language plpgsql set search_path = public as $$
begin
  update model_versions set published = true
   where model_id = p_model_id and version = p_version and not published;
  if not found then raise exception 'version not found or already published'; end if;
  update vehicle_models set current_version = p_version where id = p_model_id;
end $$;

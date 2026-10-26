-- Step 3e: admin console identity, auditing, and controlled catalog writes.
--
-- Design:
--   * App users never receive INSERT/UPDATE/DELETE on catalog tables.
--   * Admin writes go through SECURITY DEFINER RPCs that re-check membership server-side.
--   * Catalog versions remain immutable once published; review metadata may still change.
--   * Every admin/catalog mutation is recorded in an append-only audit log.
--
-- Bootstrap the first super admin once, after that person has signed up:
--   insert into public.admin_members (user_id, email, display_name, role)
--   select id, lower(email), 'Owner', 'super_admin'
--     from auth.users where lower(email) = lower('owner@example.com')
--   on conflict (user_id) do update set role = 'super_admin', status = 'active';
--
-- This migration deliberately does NOT grant DELETE on any admin table and does NOT
-- re-grant the existing catalog_* RPCs to authenticated users.

create table public.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null default 'catalog_admin' check (role in ('super_admin','catalog_admin','support_admin')),
  status text not null default 'active' check (status in ('active','suspended')),
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index admin_members_email_lower_idx on public.admin_members (lower(email));
create index admin_members_active_idx on public.admin_members (role) where status = 'active';

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  actor_email text not null,
  action text not null,
  target_type text not null,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on public.audit_events (created_at desc, id desc);
create index audit_events_actor_idx on public.audit_events (actor_user_id, created_at desc);

create trigger admin_members_updated
  before update on public.admin_members
  for each row execute function public.set_updated_at();

create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function public.forbid_modification();

-- ------------------------------------------------------------------ role checks
create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public, auth, pg_temp as $$
  select exists (
    select 1 from public.admin_members
     where user_id = auth.uid() and status = 'active'
  )
$$;

create or replace function public.is_catalog_admin()
returns boolean language sql stable security definer
set search_path = public, auth, pg_temp as $$
  select exists (
    select 1 from public.admin_members
     where user_id = auth.uid() and status = 'active'
       and role in ('super_admin','catalog_admin')
  )
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer
set search_path = public, auth, pg_temp as $$
  select exists (
    select 1 from public.admin_members
     where user_id = auth.uid() and status = 'active' and role = 'super_admin'
  )
$$;

create or replace function public.admin_touch_session()
returns jsonb language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare v_row public.admin_members;
begin
  select * into v_row from public.admin_members
   where user_id = auth.uid() and status = 'active';
  if not found then
    raise exception 'not authorized: an active administrator account is required'
      using errcode = 'insufficient_privilege';
  end if;
  update public.admin_members set last_active_at = now() where user_id = v_row.user_id;
  return to_jsonb(v_row);
end $$;

-- ------------------------------------------------------------------ audit logging
create or replace function public.log_admin_activity()
returns trigger language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_new jsonb;
  v_old jsonb;
  v_row jsonb;
  v_target_id text;
begin
  -- Touch-session writes only move last_active_at; do not flood the audit log.
  if tg_table_name = 'admin_members' and tg_op = 'UPDATE' then
    if (to_jsonb(new) ->> 'user_id', to_jsonb(new) ->> 'email', to_jsonb(new) ->> 'display_name',
        to_jsonb(new) ->> 'role', to_jsonb(new) ->> 'status')
       is not distinct from
       (to_jsonb(old) ->> 'user_id', to_jsonb(old) ->> 'email', to_jsonb(old) ->> 'display_name',
        to_jsonb(old) ->> 'role', to_jsonb(old) ->> 'status') then
      return new;
    end if;
  end if;

  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row := coalesce(v_new, v_old);

  if tg_table_name = 'admin_members' then
    v_target_id := v_row ->> 'user_id';
  elsif tg_table_name in ('model_versions','model_components') then
    v_target_id := (v_row ->> 'model_id') || ' v' || (v_row ->> 'version');
  else
    v_target_id := v_row ->> 'id';
  end if;

  select email into v_email from public.admin_members where user_id = v_uid;
  if v_email is null then
    select email into v_email from auth.users where id = v_uid;
  end if;

  insert into public.audit_events (actor_user_id, actor_email, action, target_type, target_id, detail)
  values (
    v_uid,
    coalesce(v_email, 'system'),
    lower(tg_table_name || '.' || tg_op),
    tg_table_name,
    v_target_id,
    jsonb_build_object('old', v_old, 'new', v_new)
  );
  return coalesce(new, old);
end $$;

create trigger vehicle_models_audit
  after insert or update or delete on public.vehicle_models
  for each row execute function public.log_admin_activity();

create trigger model_versions_audit
  after insert or update or delete on public.model_versions
  for each row execute function public.log_admin_activity();

create trigger model_components_audit
  after insert or update or delete on public.model_components
  for each row execute function public.log_admin_activity();

create trigger model_requests_audit
  after update on public.model_requests
  for each row execute function public.log_admin_activity();

create trigger admin_members_audit
  after insert or update or delete on public.admin_members
  for each row execute function public.log_admin_activity();

-- ------------------------------------------------------------------ catalog RPCs
create or replace function public.admin_begin_version(p_model_id uuid)
returns int language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare v_draft int;
begin
  if not public.is_catalog_admin() then
    raise exception 'not authorized: catalog admin access required' using errcode = 'insufficient_privilege';
  end if;
  -- Reuse an existing draft instead of stacking drafts on every click.
  select version into v_draft from public.model_versions
   where model_id = p_model_id and not published
   order by version desc limit 1;
  if v_draft is not null then return v_draft; end if;
  return public.catalog_begin_version(p_model_id);
end $$;

create or replace function public.admin_publish_version(p_model_id uuid, p_version int)
returns void language plpgsql security definer
set search_path = public, auth, pg_temp as $$
begin
  if not public.is_catalog_admin() then
    raise exception 'not authorized: catalog admin access required' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.model_components
     where model_id = p_model_id and version = p_version
  ) then
    raise exception 'cannot publish a catalog version with no maintenance rules'
      using errcode = 'check_violation';
  end if;
  perform public.catalog_publish_version(p_model_id, p_version);
end $$;

create or replace function public.admin_create_brand(p_slug text, p_name text)
returns uuid language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare v_slug text := lower(trim(p_slug)); v_id uuid;
begin
  if not public.is_catalog_admin() then
    raise exception 'not authorized: catalog admin access required' using errcode = 'insufficient_privilege';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'brand slug may contain lowercase letters, digits, and single hyphens' using errcode = 'check_violation';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'brand name is required' using errcode = 'check_violation';
  end if;
  insert into public.brands (slug, name) values (v_slug, trim(p_name))
  on conflict (slug) do update set name = excluded.name
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_create_model(
  p_slug text,
  p_name text,
  p_brand_slug text,
  p_type_code text,
  p_year_from int default null,
  p_year_to int default null,
  p_sort_order int default 100
) returns uuid language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare
  v_slug text := lower(trim(p_slug));
  v_brand_slug text := nullif(lower(trim(p_brand_slug)), '');
  v_brand uuid;
  v_type uuid;
  v_id uuid;
begin
  if not public.is_catalog_admin() then
    raise exception 'not authorized: catalog admin access required' using errcode = 'insufficient_privilege';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'model slug may contain lowercase letters, digits, and single hyphens' using errcode = 'check_violation';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'model name is required' using errcode = 'check_violation';
  end if;
  select id into v_type from public.vehicle_types where code = p_type_code;
  if v_type is null then raise exception 'unknown vehicle type %', p_type_code using errcode = 'check_violation'; end if;
  if v_brand_slug is not null then
    select id into v_brand from public.brands where slug = v_brand_slug;
    if v_brand is null then raise exception 'unknown brand %', v_brand_slug using errcode = 'check_violation'; end if;
  end if;
  if p_year_from is not null and p_year_from not between 1885 and 2100 then
    raise exception 'invalid year_from' using errcode = 'check_violation';
  end if;
  if p_year_to is not null and p_year_to not between 1885 and 2100 then
    raise exception 'invalid year_to' using errcode = 'check_violation';
  end if;
  if p_year_from is not null and p_year_to is not null and p_year_to < p_year_from then
    raise exception 'year_to must not be earlier than year_from' using errcode = 'check_violation';
  end if;

  insert into public.vehicle_models
    (brand_id, type_id, slug, name, is_generic, year_from, year_to, sort_order, current_version)
  values
    (v_brand, v_type, v_slug, trim(p_name), v_brand is null, p_year_from, p_year_to,
     coalesce(p_sort_order, 100), 1)
  returning id into v_id;

  insert into public.model_versions (model_id, version, published, note)
  values (v_id, 1, false, 'created in admin console');
  return v_id;
exception when unique_violation then
  raise exception 'a model with slug % already exists (or the same brand/type/name is duplicated)', v_slug
    using errcode = 'unique_violation';
end $$;

create or replace function public.admin_update_model(
  p_model_id uuid,
  p_name text,
  p_year_from int default null,
  p_year_to int default null,
  p_active boolean default true,
  p_sort_order int default 100
) returns void language plpgsql security definer
set search_path = public, auth, pg_temp as $$
begin
  if not public.is_catalog_admin() then
    raise exception 'not authorized: catalog admin access required' using errcode = 'insufficient_privilege';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'model name is required' using errcode = 'check_violation';
  end if;
  if p_year_from is not null and p_year_from not between 1885 and 2100 then
    raise exception 'invalid year_from' using errcode = 'check_violation';
  end if;
  if p_year_to is not null and p_year_to not between 1885 and 2100 then
    raise exception 'invalid year_to' using errcode = 'check_violation';
  end if;
  if p_year_from is not null and p_year_to is not null and p_year_to < p_year_from then
    raise exception 'year_to must not be earlier than year_from' using errcode = 'check_violation';
  end if;
  update public.vehicle_models
     set name = trim(p_name), year_from = p_year_from, year_to = p_year_to,
         active = coalesce(p_active, true), sort_order = coalesce(p_sort_order, 100)
   where id = p_model_id;
  if not found then raise exception 'unknown model' using errcode = 'no_data_found'; end if;
exception when unique_violation then
  raise exception 'another model in this brand/type already uses that name' using errcode = 'unique_violation';
end $$;

create or replace function public.admin_save_rule(
  p_model_id uuid,
  p_component_id uuid,
  p_version int,
  p_interval_km int,
  p_interval_days int,
  p_warn_remaining_pct numeric,
  p_unknown_history_rule jsonb,
  p_source_note text,
  p_review_status text,
  p_reviewed_by text
) returns void language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare v_published boolean;
begin
  if not public.is_catalog_admin() then
    raise exception 'not authorized: catalog admin access required' using errcode = 'insufficient_privilege';
  end if;
  select published into v_published from public.model_versions
   where model_id = p_model_id and version = p_version;
  if not found then raise exception 'unknown catalog version' using errcode = 'no_data_found'; end if;
  if v_published then
    raise exception 'published catalog versions are frozen; create a new version'
      using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from public.component_definitions where id = p_component_id) then
    raise exception 'unknown component' using errcode = 'no_data_found';
  end if;
  if p_review_status not in ('draft','reviewed') then
    raise exception 'invalid review status' using errcode = 'check_violation';
  end if;
  if p_review_status = 'reviewed' and nullif(trim(p_reviewed_by), '') is null then
    raise exception 'a reviewer name is required before a value can be marked reviewed'
      using errcode = 'check_violation';
  end if;

  insert into public.model_components
    (model_id, component_id, version, interval_km, interval_days, warn_remaining_pct,
     unknown_history_rule, review_status, reviewed_by, reviewed_at, source_note)
  values
    (p_model_id, p_component_id, p_version, p_interval_km, p_interval_days,
     coalesce(p_warn_remaining_pct, 25), p_unknown_history_rule,
     p_review_status,
     case when p_review_status = 'reviewed' then trim(p_reviewed_by) end,
     case when p_review_status = 'reviewed' then now() end,
     nullif(trim(p_source_note), ''))
  on conflict (model_id, component_id, version) do update
    set interval_km = excluded.interval_km,
        interval_days = excluded.interval_days,
        warn_remaining_pct = excluded.warn_remaining_pct,
        unknown_history_rule = excluded.unknown_history_rule,
        review_status = excluded.review_status,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        source_note = excluded.source_note;
end $$;

create or replace function public.admin_delete_rule(
  p_model_id uuid,
  p_component_id uuid,
  p_version int
) returns void language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare v_published boolean;
begin
  if not public.is_catalog_admin() then
    raise exception 'not authorized: catalog admin access required' using errcode = 'insufficient_privilege';
  end if;
  select published into v_published from public.model_versions
   where model_id = p_model_id and version = p_version;
  if not found then raise exception 'unknown catalog version' using errcode = 'no_data_found'; end if;
  if v_published then
    raise exception 'published catalog rows cannot be deleted; create a new version'
      using errcode = 'restrict_violation';
  end if;
  delete from public.model_components
   where model_id = p_model_id and component_id = p_component_id and version = p_version;
  if not found then raise exception 'rule not found' using errcode = 'no_data_found'; end if;
end $$;

create or replace function public.admin_review_rule(
  p_model_id uuid,
  p_component_id uuid,
  p_version int,
  p_reviewed boolean,
  p_reviewed_by text,
  p_source_note text default null
) returns void language plpgsql security definer
set search_path = public, auth, pg_temp as $$
begin
  if not public.is_catalog_admin() then
    raise exception 'not authorized: catalog admin access required' using errcode = 'insufficient_privilege';
  end if;
  if p_reviewed and nullif(trim(p_reviewed_by), '') is null then
    raise exception 'a reviewer name is required before a value can be marked reviewed'
      using errcode = 'check_violation';
  end if;
  update public.model_components
     set review_status = case when p_reviewed then 'reviewed' else 'draft' end,
         reviewed_by = case when p_reviewed then trim(p_reviewed_by) end,
         reviewed_at = case when p_reviewed then now() end,
         source_note = coalesce(nullif(trim(p_source_note), ''), source_note)
   where model_id = p_model_id and component_id = p_component_id and version = p_version;
  if not found then raise exception 'rule not found' using errcode = 'no_data_found'; end if;
end $$;

create or replace function public.admin_set_request_status(
  p_request_ids uuid[],
  p_status text
) returns int language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare v_count int;
begin
  if not public.is_admin() then
    raise exception 'not authorized: admin access required' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('new','added','rejected') then
    raise exception 'invalid request status' using errcode = 'check_violation';
  end if;
  if p_request_ids is null or cardinality(p_request_ids) = 0 then return 0; end if;
  update public.model_requests
     set status = p_status
   where id = any(p_request_ids);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ------------------------------------------------------------------ membership RPCs
create or replace function public.admin_grant_role(
  p_email text,
  p_display_name text,
  p_role text
) returns uuid language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare
  v_email text := lower(trim(p_email));
  v_name text := nullif(trim(p_display_name), '');
  v_uid uuid;
begin
  if not public.is_super_admin() then
    raise exception 'not authorized: super admin access required' using errcode = 'insufficient_privilege';
  end if;
  if v_email is null or v_email = '' then
    raise exception 'email is required' using errcode = 'check_violation';
  end if;
  if p_role not in ('super_admin','catalog_admin','support_admin') then
    raise exception 'invalid admin role' using errcode = 'check_violation';
  end if;
  select id into v_uid from auth.users where lower(email) = v_email limit 1;
  if v_uid is null then
    raise exception 'no account found for %; the person must sign up before being granted access', v_email
      using errcode = 'no_data_found';
  end if;
  if v_uid = auth.uid() and p_role <> 'super_admin' then
    raise exception 'you cannot demote yourself' using errcode = 'insufficient_privilege';
  end if;
  insert into public.admin_members (user_id, email, display_name, role, status)
  values (v_uid, v_email, coalesce(v_name, split_part(v_email, '@', 1)), p_role, 'active')
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = coalesce(v_name, public.admin_members.display_name),
        role = excluded.role,
        status = 'active';
  return v_uid;
end $$;

create or replace function public.admin_update_member(
  p_user_id uuid,
  p_role text,
  p_status text
) returns void language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare v_is_last_super boolean;
begin
  if not public.is_super_admin() then
    raise exception 'not authorized: super admin access required' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('super_admin','catalog_admin','support_admin') then
    raise exception 'invalid admin role' using errcode = 'check_violation';
  end if;
  if p_status not in ('active','suspended') then
    raise exception 'invalid member status' using errcode = 'check_violation';
  end if;
  if p_user_id = auth.uid() and (p_role <> 'super_admin' or p_status <> 'active') then
    raise exception 'you cannot change your own role or status' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.admin_members
              where user_id = p_user_id and role = 'super_admin' and status = 'active')
     and (p_role <> 'super_admin' or p_status <> 'active') then
    select count(*) = 1 into v_is_last_super from public.admin_members
     where role = 'super_admin' and status = 'active';
    if v_is_last_super then
      raise exception 'at least one active super admin must remain' using errcode = 'check_violation';
    end if;
  end if;
  update public.admin_members set role = p_role, status = p_status where user_id = p_user_id;
  if not found then raise exception 'admin member not found' using errcode = 'no_data_found'; end if;
end $$;

create or replace function public.admin_health()
returns jsonb language plpgsql security definer
set search_path = public, auth, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized: admin access required' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'database_time', now(),
    'models', (select count(*) from public.vehicle_models),
    'active_models', (select count(*) from public.vehicle_models where active),
    'archived_models', (select count(*) from public.vehicle_models where not active),
    'versions', (select count(*) from public.model_versions),
    'draft_versions', (select count(*) from public.model_versions where not published),
    'rules', (select count(*) from public.model_components),
    'reviewed_rules', (select count(*) from public.model_components where review_status = 'reviewed'),
    'open_requests', (select count(*) from public.model_requests where status = 'new'),
    'admin_members', (select count(*) from public.admin_members where status = 'active'),
    'audit_events', (select count(*) from public.audit_events),
    'role', (select role from public.admin_members where user_id = auth.uid())
  );
end $$;

-- ------------------------------------------------------------------ RLS
alter table public.admin_members enable row level security;
alter table public.audit_events enable row level security;

create policy admin_members_select on public.admin_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy audit_events_select on public.audit_events
  for select to authenticated
  using (public.is_admin());

-- Admins may read unpublished versions/rules and every model request.
-- These policies are additive to the existing user-facing policies.
create policy admin_read_unpublished_versions on public.model_versions
  for select to authenticated using (public.is_admin());
create policy admin_read_all_components on public.model_components
  for select to authenticated using (public.is_admin());
create policy admin_read_all_requests on public.model_requests
  for select to authenticated using (public.is_admin());

-- New tables start with no app-facing writes. All mutations go through the RPCs above.
revoke all on public.admin_members, public.audit_events from anon, authenticated;
grant select on public.admin_members, public.audit_events to authenticated;

-- Function privileges: nothing for anonymous users, explicit execute for signed-in admins.
revoke all on function public.is_admin(), public.is_catalog_admin(), public.is_super_admin()
  from public, anon, authenticated;
revoke all on function public.admin_touch_session() from public, anon, authenticated;
revoke all on function public.log_admin_activity() from public, anon, authenticated;
revoke all on function public.admin_begin_version(uuid) from public, anon, authenticated;
revoke all on function public.admin_publish_version(uuid, int) from public, anon, authenticated;
revoke all on function public.admin_create_brand(text, text) from public, anon, authenticated;
revoke all on function public.admin_create_model(text, text, text, text, int, int, int) from public, anon, authenticated;
revoke all on function public.admin_update_model(uuid, text, int, int, boolean, int) from public, anon, authenticated;
revoke all on function public.admin_save_rule(uuid, uuid, int, int, int, numeric, jsonb, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_delete_rule(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.admin_review_rule(uuid, uuid, int, boolean, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_set_request_status(uuid[], text) from public, anon, authenticated;
revoke all on function public.admin_grant_role(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_update_member(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_health() from public, anon, authenticated;

grant execute on function public.is_admin(), public.is_catalog_admin(), public.is_super_admin()
  to authenticated, service_role;
grant execute on function public.admin_touch_session() to authenticated, service_role;
grant execute on function public.admin_begin_version(uuid) to authenticated, service_role;
grant execute on function public.admin_publish_version(uuid, int) to authenticated, service_role;
grant execute on function public.admin_create_brand(text, text) to authenticated, service_role;
grant execute on function public.admin_create_model(text, text, text, text, int, int, int)
  to authenticated, service_role;
grant execute on function public.admin_update_model(uuid, text, int, int, boolean, int)
  to authenticated, service_role;
grant execute on function public.admin_save_rule(uuid, uuid, int, int, int, numeric, jsonb, text, text, text)
  to authenticated, service_role;
grant execute on function public.admin_delete_rule(uuid, uuid, int) to authenticated, service_role;
grant execute on function public.admin_review_rule(uuid, uuid, int, boolean, text, text)
  to authenticated, service_role;
grant execute on function public.admin_set_request_status(uuid[], text) to authenticated, service_role;
grant execute on function public.admin_grant_role(text, text, text) to authenticated, service_role;
grant execute on function public.admin_update_member(uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_health() to authenticated, service_role;

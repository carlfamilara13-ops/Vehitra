-- Step 3a: RPC, row level security, and privileges.

-- Atomic, idempotent part replacement: closes the old install and creates the new one in ONE transaction.
-- Runs as the caller (security invoker), so RLS and ownership checks apply. Safe to retry with the same p_new_install_id.
create or replace function public.replace_part_install(
  p_old_install_id uuid,
  p_new_install_id uuid,
  p_user_vehicle_id uuid,
  p_component_id uuid,
  p_brand text,
  p_model text,
  p_replaced_at timestamptz,
  p_odo numeric,
  p_notes text default null,
  p_close_notes text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
begin
  if exists (select 1 from part_installs where id = p_new_install_id) then
    return p_new_install_id; -- retry of an already-applied replacement
  end if;
  if p_old_install_id is not null then
    update part_installs
       set removed_at = p_replaced_at, removal_odo = p_odo, close_notes = p_close_notes
     where id = p_old_install_id
       and user_vehicle_id = p_user_vehicle_id
       and component_id = p_component_id
       and removed_at is null;
    if not found then
      raise exception 'old install not found or already closed';
    end if;
  end if;
  insert into part_installs (id, user_vehicle_id, component_id, brand, model, installed_at, install_odo, notes)
  values (p_new_install_id, p_user_vehicle_id, p_component_id, p_brand, p_model, p_replaced_at, p_odo, p_notes);
  return p_new_install_id;
end $$;

-- Row level security on EVERY table.
alter table public.vehicle_types enable row level security;
alter table public.brands enable row level security;
alter table public.assets enable row level security;
alter table public.component_definitions enable row level security;
alter table public.vehicle_models enable row level security;
alter table public.model_versions enable row level security;
alter table public.model_components enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_vehicles enable row level security;
alter table public.rides enable row level security;
alter table public.mileage_entries enable row level security;
alter table public.service_events enable row level security;
alter table public.part_installs enable row level security;
alter table public.component_overrides enable row level security;
alter table public.deadlines enable row level security;
alter table public.model_requests enable row level security;

-- Catalog: read-only for signed-in users. Unpublished versions are invisible.
create policy catalog_read on public.vehicle_types for select to authenticated using (true);
create policy catalog_read on public.brands for select to authenticated using (true);
create policy catalog_read on public.assets for select to authenticated using (true);
create policy catalog_read on public.component_definitions for select to authenticated using (true);
create policy catalog_read on public.vehicle_models for select to authenticated using (true);
create policy catalog_read on public.model_versions for select to authenticated using (published);
create policy catalog_read on public.model_components for select to authenticated using (
  exists (select 1 from public.model_versions v
           where v.model_id = model_components.model_id and v.version = model_components.version and v.published));

-- User-owned tables: own rows only.
create policy own_select on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.user_settings for insert to authenticated with check (user_id = auth.uid());
create policy own_update on public.user_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_select on public.user_vehicles for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.user_vehicles for insert to authenticated with check (user_id = auth.uid());
create policy own_update on public.user_vehicles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_select on public.rides for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.rides for insert to authenticated with check (user_id = auth.uid());
create policy own_update on public.rides for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_select on public.mileage_entries for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.mileage_entries for insert to authenticated with check (user_id = auth.uid());

create policy own_select on public.service_events for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.service_events for insert to authenticated with check (user_id = auth.uid());

create policy own_select on public.part_installs for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.part_installs for insert to authenticated with check (user_id = auth.uid());
create policy own_update on public.part_installs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_select on public.component_overrides for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.component_overrides for insert to authenticated with check (user_id = auth.uid());
create policy own_update on public.component_overrides for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_delete on public.component_overrides for delete to authenticated using (user_id = auth.uid());

create policy own_select on public.deadlines for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.deadlines for insert to authenticated with check (user_id = auth.uid());
create policy own_update on public.deadlines for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_select on public.model_requests for select to authenticated using (user_id = auth.uid());
create policy own_insert on public.model_requests for insert to authenticated with check (user_id = auth.uid());

-- Privileges: start from nothing, grant only what each role needs (defence in depth beyond RLS).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.vehicle_types, public.brands, public.assets, public.component_definitions,
                public.vehicle_models, public.model_versions, public.model_components to authenticated;
grant select, insert, update on public.user_settings, public.user_vehicles, public.rides,
                                 public.part_installs, public.deadlines to authenticated;
grant select, insert on public.mileage_entries, public.service_events, public.model_requests to authenticated;
grant select, insert, update, delete on public.component_overrides to authenticated;

grant execute on function public.replace_part_install(uuid, uuid, uuid, uuid, text, text, timestamptz, numeric, text, text) to authenticated;
-- Catalog admin functions: NOT callable by app users. Run with the service role or in the SQL editor.
grant execute on function public.catalog_begin_version(uuid), public.catalog_publish_version(uuid, int) to service_role;

-- Public read-only vehicle catalog images. Account-owned tables and policies are unchanged.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehitra-catalog-images', 'vehitra-catalog-images', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

grant select on public.vehicle_types, public.brands, public.assets, public.component_definitions,
  public.vehicle_models, public.model_versions, public.model_components to anon;

create policy public_catalog_anon_read on public.vehicle_types for select to anon using (true);
create policy public_catalog_anon_read on public.brands for select to anon using (true);
create policy public_catalog_anon_read on public.component_definitions for select to anon using (true);
create policy public_catalog_anon_read on public.vehicle_models for select to anon using (active);
create policy public_catalog_anon_read on public.assets for select to anon using (
  exists (select 1 from public.vehicle_models m where m.image_asset_id = assets.id and m.active)
);
create policy public_catalog_anon_read on public.model_versions for select to anon using (published);
create policy public_catalog_anon_read on public.model_components for select to anon using (
  exists (select 1 from public.model_versions v
    where v.model_id = model_components.model_id and v.version = model_components.version and v.published)
);

create policy vehicle_catalog_images_public_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'vehitra-catalog-images');
create policy vehicle_catalog_images_admin_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'vehitra-catalog-images' and public.is_catalog_admin()
    and exists (select 1 from public.vehicle_models m where m.id::text = split_part(name, '/', 1))
  );
create policy vehicle_catalog_images_admin_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'vehitra-catalog-images' and public.is_catalog_admin()
    and exists (select 1 from public.vehicle_models m where m.id::text = split_part(name, '/', 1))
  );

create or replace function public.admin_set_model_image(
  p_model_id uuid,
  p_storage_path text,
  p_content_type text,
  p_bytes integer
) returns text language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare v_old_path text; v_asset_id uuid;
begin
  if not public.is_catalog_admin() then
    raise exception 'not authorized: catalog admin access required' using errcode = 'insufficient_privilege';
  end if;
  select a.storage_path into v_old_path
    from public.vehicle_models m left join public.assets a on a.id = m.image_asset_id
   where m.id = p_model_id for update of m;
  if not found then raise exception 'unknown vehicle model' using errcode = 'no_data_found'; end if;

  if p_storage_path is null then
    update public.vehicle_models set image_asset_id = null where id = p_model_id;
  else
    if p_storage_path !~ ('^' || p_model_id::text || '/[a-zA-Z0-9-]+[.](jpg|png|webp)$')
       or p_content_type not in ('image/jpeg','image/png','image/webp')
       or p_bytes is null or p_bytes < 1 or p_bytes > 8388608 then
      raise exception 'invalid vehicle image metadata' using errcode = 'check_violation';
    end if;
    insert into public.assets(kind, storage_path, content_type, bytes)
      values ('vehicle_image', p_storage_path, p_content_type, p_bytes) returning id into v_asset_id;
    update public.vehicle_models set image_asset_id = v_asset_id where id = p_model_id;
  end if;

  if v_old_path is not null and v_old_path is distinct from p_storage_path then
    delete from public.assets a where a.storage_path = v_old_path
      and not exists (select 1 from public.vehicle_models m where m.image_asset_id = a.id);
  end if;

  insert into public.audit_events(actor_user_id, actor_email, action, target_type, target_id, detail)
  values (auth.uid(), coalesce((select email from public.admin_members where user_id = auth.uid()), ''), 'vehicle_image_updated', 'vehicle_model', p_model_id::text,
    jsonb_build_object('old_path', v_old_path, 'new_path', p_storage_path));
  return v_old_path;
end $$;

revoke all on function public.admin_set_model_image(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.admin_set_model_image(uuid, text, text, integer) to authenticated, service_role;

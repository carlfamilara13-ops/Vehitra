-- Step 3a: shared helper functions.

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Rows protected by this trigger can never be updated or deleted directly.
-- Cascading deletes (account deletion removes auth.users -> user rows) are allowed:
-- referential actions run as nested triggers, so pg_trigger_depth() > 1.
create or replace function public.forbid_modification()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% on % is not allowed: rows are immutable (add a correcting entry instead)', tg_op, tg_table_name
    using errcode = 'restrict_violation';
end $$;

create or replace function public.forbid_delete()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    return old; -- cascade from account deletion
  end if;
  raise exception 'DELETE on % is not allowed', tg_table_name using errcode = 'restrict_violation';
end $$;

-- Lifecycle settings are synced from config/assignment-lifecycle.yaml; durations are integer seconds.
-- The lease is a liveness heartbeat: set at claim, renewed by the worker, never chosen by a client.
create table public.assignment_settings (
  singleton boolean primary key default true check (singleton),
  value jsonb not null
);
alter table public.assignment_settings enable row level security;
revoke all on public.assignment_settings from public, anon, authenticated, service_role;

create function public.assignment_settings_get()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((select jsonb_build_object('ok',true,'settings',value) from public.assignment_settings),
    public.assignment_error('not_configured'));
$$;

-- Seconds as a pg_cron schedule: whole minutes as a cron expression, otherwise pg_cron's seconds form.
create function public.assignment_cron_schedule(p_seconds integer)
returns text language sql immutable set search_path='' as $$
  select case when p_seconds % 60 = 0 then '*/' || (p_seconds / 60) || ' * * * *' else p_seconds || ' seconds' end;
$$;

create function public.assignment_settings_apply(p_value jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_lease integer; v_heartbeat integer;
begin
  v_lease := (p_value->'lease'->>'duration')::integer;
  v_heartbeat := (p_value->'heartbeat'->>'interval')::integer;
  if v_lease is null or v_heartbeat is null or v_lease <= 0 or v_heartbeat <= 0 or v_heartbeat >= v_lease then
    raise exception 'invalid lifecycle settings: lease.duration must be positive and exceed heartbeat.interval'
      using errcode = '22023';
  end if;
  insert into public.assignment_settings(singleton, value) values (true, p_value)
    on conflict (singleton) do update set value = excluded.value;
  -- The scan job exists once pg_cron and the scan function are installed.
  if to_regprocedure('cron.schedule(text,text,text)') is not null
     and to_regprocedure('public.assignment_lifecycle_scan()') is not null then
    perform cron.schedule('assignment-lifecycle-scan',
      public.assignment_cron_schedule((p_value->'expiry'->>'check_interval')::integer),
      'select public.assignment_lifecycle_scan()');
  end if;
end $$;

create or replace function public.assignment_error(p_code text,p_fields jsonb default '{}')
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('ok',false,'code',p_code,'message',case p_code
    when 'missing_dependencies' then 'Prerequisites do not exist. Use list_assignments to find their IDs.'
    when 'stale_claim' then 'Execution claim is no longer current. Stop and inspect the assignment.'
    when 'stale_update' then 'TODO changed. Inspect the current version before writing.'
    when 'not_claimable' then 'Assignment is not ready to claim. Inspect its state and dependencies.'
    when 'unfinished_todos' then 'Unfinished TODOs prevent completion.'
    when 'assignment_closed' then 'Terminal assignments cannot be changed or reopened.'
    when 'invalid_transition' then 'Operation is not allowed in the current assignment/TODO state.'
    when 'not_found' then 'Assignment or TODO not found for this project.'
    when 'id_exhausted' then 'Could not allocate an assignment ID. Inspect before retrying.'
    when 'not_configured' then 'Lifecycle settings are not synced. Run the settings sync before claiming.'
    else 'Invalid input. Check identity, nonblank text, arrays, and exact timestamp tokens.' end) || p_fields;
$$;

-- Replace the fixed 45-minute lease: a lease exists exactly while the assignment is in process.
do $$
declare v_name text;
begin
  for v_name in select conname from pg_constraint where conrelid = 'public.assignments'::regclass
    and contype = 'c' and pg_get_constraintdef(oid) like '%lease_expired_at%'
  loop
    execute format('alter table public.assignments drop constraint %I', v_name);
  end loop;
end $$;
alter table public.assignments add column claim_conversation_id uuid;
update public.assignments set lease_expired_at = null where status <> 'in_process';
update public.assignments set claim_conversation_id = gen_random_uuid() where status = 'in_process';
alter table public.assignments
  add constraint assignments_lease_in_process check ((status = 'in_process') = (lease_expired_at is not null));

-- Every transition out of in_process (block, blocked report, finish, reactivate, close) drops the lease.
create function public.assignment_clear_lease()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status <> 'in_process' then new.lease_expired_at := null; end if;
  return new;
end $$;
create trigger assignment_clear_lease before update on public.assignments
  for each row execute function public.assignment_clear_lease();

create function public.assignment_lease_duration()
returns interval language sql stable security definer set search_path='' as $$
  select make_interval(secs => (value->'lease'->>'duration')::integer) from public.assignment_settings;
$$;

drop function public.assignment_claim(text,text,text,text[]);
create function public.assignment_claim(p_project text,p_assignment_id text,p_claimed_by text,p_abilities text[],
  p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_error jsonb; v_result jsonb; v_missing text[]; v_lease interval;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id)
    or not public.assignment_nonblank(p_claimed_by) or p_conversation_id is null then return public.assignment_error('invalid_input'); end if;
  v_lease := public.assignment_lease_duration();
  if v_lease is null then return public.assignment_error('not_configured'); end if;
  v_error:=public.assignment_ability_error(p_abilities);
  if v_error is not null then return v_error; end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  v_missing:=array(select unnest(v_row.require_abilities) except select unnest(p_abilities));
  if cardinality(v_missing)>0 then return jsonb_build_object(
    'ok',false,'code','ability_mismatch','message','This worker lacks required specialist abilities. Nothing was claimed.',
    'assignment',public.assignment_view(v_row),'missing',to_jsonb(v_missing)); end if;
  v_result:=public.assignment_claim_ready(p_project,p_assignment_id);
  if not (v_result->>'ok')::boolean then return v_result; end if;
  update public.assignments set claimed_by=p_claimed_by,claim_conversation_id=p_conversation_id,
    lease_expired_at=now()+v_lease where id=p_assignment_id returning * into v_row;
  return public.assignment_detail(v_row);
end $$;

-- Heartbeat: extends a live lease by the configured duration. Not an assignment change.
create function public.assignment_renew(p_project text,p_assignment_id text,p_claimed_at timestamptz,
  p_claimed_by text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_error jsonb; v_lease interval;
begin
  v_error:=public.assignment_claimant_error(p_project,p_assignment_id,p_claimed_at,p_claimed_by);
  if v_error is not null then return v_error; end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id;
  v_lease := public.assignment_lease_duration();
  if v_row.status<>'in_process' or v_row.lease_expired_at<now() or v_lease is null then
    return public.assignment_error('stale_claim',jsonb_build_object('assignment',public.assignment_view(v_row)));
  end if;
  update public.assignments set lease_expired_at=now()+v_lease where id=p_assignment_id returning * into v_row;
  return jsonb_build_object('ok',true,'assignment',public.assignment_view(v_row));
end $$;

revoke all on function public.assignment_settings_get(), public.assignment_settings_apply(jsonb),
  public.assignment_cron_schedule(integer), public.assignment_clear_lease(), public.assignment_lease_duration(),
  public.assignment_claim(text,text,text,text[],uuid), public.assignment_renew(text,text,timestamptz,text)
  from public, anon, authenticated, service_role;
grant execute on function public.assignment_settings_get(),
  public.assignment_claim(text,text,text,text[],uuid), public.assignment_renew(text,text,timestamptz,text)
  to service_role;

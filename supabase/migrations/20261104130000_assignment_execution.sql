-- Whole-assignment execution. Lease timestamps are informational, never deadlines.
drop index public.assignments_active_project;
alter table public.assignments drop constraint assignments_status_check;
alter table public.assignments drop constraint assignments_check;
alter table public.assignments
  add column claimed_at timestamptz,
  add column lease_expired_at timestamptz,
  add column blocker text,
  add check (status in ('active','in_process','blocked','done','cancelled')),
  add check ((status in ('done','cancelled')) = (closed_at is not null)),
  add check ((claimed_at is null) = (lease_expired_at is null)),
  add check (claimed_at is null or (isfinite(claimed_at) and isfinite(lease_expired_at)
    and lease_expired_at = claimed_at + interval '45 minutes')),
  add check (status <> 'active' or claimed_at is null),
  add check (status <> 'in_process' or claimed_at is not null),
  add check (blocker is null or public.assignment_nonblank(blocker)),
  add check (status <> 'blocked' or blocker is not null),
  add check (status not in ('active','in_process') or blocker is null);
create index assignments_active_order on public.assignments(created_at,id) where status='active';

create table public.assignment_dependencies (
  assignment_id text not null references public.assignments(id),
  prerequisite_assignment_id text not null references public.assignments(id),
  primary key (assignment_id,prerequisite_assignment_id),
  check (assignment_id <> prerequisite_assignment_id)
);
create index assignment_dependencies_prerequisite
  on public.assignment_dependencies(prerequisite_assignment_id,assignment_id);
alter table public.assignment_dependencies enable row level security;
revoke all on public.assignment_dependencies from public,anon,authenticated,service_role;

alter table public.todos drop constraint todos_status_check;
alter table public.todos
  add column evidence text[] not null default '{}',
  add column blocker text,
  add check (status in ('todo','in_progress','blocked','done','cancelled')),
  add check (array_ndims(evidence) is null or array_ndims(evidence)=1),
  add check (array_position(evidence,null) is null),
  add check (blocker is null or public.assignment_nonblank(blocker)),
  add check (status <> 'blocked' or blocker is not null);

-- A single wake-up hint, not a queue, assignment payload, or consumption ledger.
create table public.assignment_availability (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0)
);
insert into public.assignment_availability(singleton) values(true);
alter table public.assignment_availability enable row level security;
revoke all on public.assignment_availability from public,anon,authenticated,service_role;
grant select on public.assignment_availability to service_role;
alter publication supabase_realtime add table public.assignment_availability;

create function public.assignment_signal()
returns void language sql security definer set search_path='' as $$
  update public.assignment_availability set revision=revision+1 where singleton;
$$;

create function public.assignment_valid_target(p_project text,p_id text)
returns boolean language sql immutable set search_path='' as $$
  select public.assignment_valid_project(p_project) and p_id is not null and p_id ~ '^[0-9a-f]{8}$';
$$;

create function public.assignment_valid_text_array(p_values text[],p_empty boolean default false)
returns boolean language sql immutable set search_path='' as $$
  select p_values is not null and (cardinality(p_values)=0 and p_empty or
    array_ndims(p_values)=1 and array_lower(p_values,1)=1 and cardinality(p_values)>0
    and not exists(select 1 from unnest(p_values) v where not public.assignment_nonblank(v)));
$$;

create function public.assignment_error(p_code text,p_fields jsonb default '{}')
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
    else 'Invalid input. Check identity, nonblank text, arrays, and exact timestamp tokens.' end) || p_fields;
$$;

create function public.assignment_view(p_row public.assignments)
returns jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(p_row) || jsonb_build_object(
    'dependencies',coalesce((select jsonb_agg(jsonb_build_object(
      'assignment_id',a.id,'project',a.project,'status',a.status) order by a.id)
      from public.assignment_dependencies d join public.assignments a on a.id=d.prerequisite_assignment_id
      where d.assignment_id=p_row.id),'[]'::jsonb),
    'ready',p_row.status='active' and p_row.claimed_at is null
      and not exists(select 1 from public.assignment_dependencies d join public.assignments a
        on a.id=d.prerequisite_assignment_id where d.assignment_id=p_row.id and a.status<>'done')
      and exists(select 1 from public.todos where assignment_id=p_row.id and status='todo')
      and not exists(select 1 from public.todos where assignment_id=p_row.id and status in ('blocked','in_progress')));
$$;

create function public.assignment_detail(p_row public.assignments)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('ok',true,'assignment',public.assignment_view(p_row),'todos',
    coalesce((select jsonb_agg(to_jsonb(t) order by position) from public.todos t where assignment_id=p_row.id),'[]'::jsonb));
$$;

create function public.assignment_execution_error(p_row public.assignments,p_claimed_at timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_claimed_at is null or not isfinite(p_claimed_at) then public.assignment_error('invalid_input')
    when p_row.status<>'in_process' or p_row.claimed_at is distinct from p_claimed_at
      then public.assignment_error('stale_claim',jsonb_build_object('assignment',public.assignment_view(p_row))) end;
$$;

-- Remove signatures that permit incomplete creation or model-owned progress.
drop function public.assignment_create(text,text,text);
drop function public.assignment_update_todo(text,text,integer,timestamptz,text,text,text);

create function public.assignment_create(p_project text,p_goal text,p_initial_todos text[],
  p_constraints text default '',p_depends_on_assignment_ids text[] default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_missing text[]; v_constraint text; v_attempt integer:=0;
begin
  if not public.assignment_valid_project(p_project) or not public.assignment_nonblank(p_goal) or p_constraints is null
    or not public.assignment_valid_text_array(p_initial_todos)
    or not public.assignment_valid_text_array(p_depends_on_assignment_ids,true)
    or exists(select 1 from unnest(p_depends_on_assignment_ids) d where d !~ '^[0-9a-f]{8}$') then
    return public.assignment_error('invalid_input');
  end if;
  select array_agg(d order by d) into v_missing from (select distinct unnest(p_depends_on_assignment_ids) d) refs
    where not exists(select 1 from public.assignments where id=d);
  if v_missing is not null then return public.assignment_error('missing_dependencies',jsonb_build_object('missing_assignment_ids',v_missing)); end if;
  loop
    v_attempt:=v_attempt+1;
    if v_attempt>100 then return public.assignment_error('id_exhausted'); end if;
    begin
      insert into public.assignments(id,project,goal,constraints)
        values(left(gen_random_uuid()::text,8),p_project,p_goal,p_constraints) returning * into v_row;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint=constraint_name;
      if v_constraint<>'assignments_pkey' then raise; end if;
    end;
  end loop;
  insert into public.todos(assignment_id,position,description)
    select v_row.id,n::integer,d from unnest(p_initial_todos) with ordinality as x(d,n);
  insert into public.assignment_dependencies(assignment_id,prerequisite_assignment_id)
    select v_row.id,d from (select distinct unnest(p_depends_on_assignment_ids) d) refs;
  perform public.assignment_signal();
  return public.assignment_detail(v_row);
end $$;

create or replace function public.assignment_list(p_project text default null,p_status text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_project is not null and not public.assignment_valid_project(p_project)
    or p_status is not null and p_status not in ('active','in_process','blocked','done','cancelled') then
    return public.assignment_error('invalid_input');
  end if;
  return jsonb_build_object('ok',true,'assignments',coalesce((select jsonb_agg(public.assignment_view(a) order by a.created_at desc,a.id desc)
    from public.assignments a where (p_project is null or a.project=p_project) and (p_status is null or a.status=p_status)),'[]'::jsonb));
end $$;

create or replace function public.assignment_get(p_project text,p_assignment_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id;
  if not found then return public.assignment_error('not_found'); end if;
  return public.assignment_detail(v_row);
end $$;

create or replace function public.assignment_append_todos(p_project text,p_assignment_id text,p_descriptions text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_start integer; v_todos jsonb;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) or not public.assignment_valid_text_array(p_descriptions) then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  if v_row.status in ('done','cancelled') then return public.assignment_error('assignment_closed',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
  if v_row.status not in ('active','blocked') then return public.assignment_error('invalid_transition',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
  select coalesce(max(position),0) into v_start from public.todos where assignment_id=p_assignment_id;
  if cardinality(p_descriptions)::bigint+v_start>2147483647 then return public.assignment_error('invalid_input'); end if;
  with added as (insert into public.todos(assignment_id,position,description)
    select p_assignment_id,v_start+n::integer,d from unnest(p_descriptions) with ordinality as x(d,n) returning *)
    select jsonb_agg(to_jsonb(added) order by position) into v_todos from added;
  if v_row.status='active' then perform public.assignment_signal(); end if;
  return jsonb_build_object('ok',true,'todos',v_todos);
end $$;

create function public.assignment_update_todo(p_project text,p_assignment_id text,p_position integer,
  p_expected_updated_at timestamptz,p_description text default null,p_status text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_todo public.todos;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) or p_position is null or p_position<1
    or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or (p_description is null and p_status is null) or (p_description is not null and not public.assignment_nonblank(p_description))
    or (p_status is not null and p_status<>'cancelled') then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  if v_row.status in ('done','cancelled') then return public.assignment_error('assignment_closed',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
  if v_row.status not in ('active','blocked') then return public.assignment_error('invalid_transition',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
  select * into v_todo from public.todos where assignment_id=p_assignment_id and position=p_position;
  if not found then return public.assignment_error('not_found'); end if;
  if v_todo.updated_at<>p_expected_updated_at then return public.assignment_error('stale_update',jsonb_build_object('todo',to_jsonb(v_todo))); end if;
  if v_todo.status in ('done','cancelled') then return public.assignment_error('invalid_transition',jsonb_build_object('todo',to_jsonb(v_todo))); end if;
  update public.todos set description=coalesce(p_description,description),status=coalesce(p_status,status),
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
    where assignment_id=p_assignment_id and position=p_position returning * into v_todo;
  if v_row.status='active' then perform public.assignment_signal(); end if;
  return jsonb_build_object('ok',true,'todo',to_jsonb(v_todo));
end $$;

create or replace function public.assignment_close(p_project text,p_assignment_id text,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) or p_status is distinct from 'cancelled' then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  if v_row.status='cancelled' then return jsonb_build_object('ok',true,'assignment',public.assignment_view(v_row)); end if;
  if v_row.status='done' then return public.assignment_error('assignment_closed',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
  update public.assignments set status='cancelled',closed_at=clock_timestamp(),updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_assignment_id returning * into v_row;
  perform public.assignment_signal();
  return jsonb_build_object('ok',true,'assignment',public.assignment_view(v_row));
end $$;

create function public.assignment_claim(p_project text,p_assignment_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_reason text; v_token timestamptz;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  v_reason:=case when v_row.status<>'active' then 'status' when v_row.claimed_at is not null then 'claimed'
    when exists(select 1 from public.assignment_dependencies d join public.assignments a on a.id=d.prerequisite_assignment_id where d.assignment_id=p_assignment_id and a.status<>'done') then 'dependencies'
    when exists(select 1 from public.todos where assignment_id=p_assignment_id and status in ('blocked','in_progress')) then 'todo_state'
    when not exists(select 1 from public.todos where assignment_id=p_assignment_id and status='todo') then 'no_executable_todos' end;
  if v_reason is not null then return public.assignment_error('not_claimable',jsonb_build_object('assignment',public.assignment_view(v_row),'reason',v_reason)); end if;
  v_token:=greatest(clock_timestamp(),v_row.updated_at+interval '1 microsecond');
  update public.assignments set status='in_process',claimed_at=v_token,lease_expired_at=v_token+interval '45 minutes',updated_at=v_token where id=p_assignment_id returning * into v_row;
  return public.assignment_detail(v_row);
end $$;

create function public.assignment_start_todo(p_project text,p_assignment_id text,p_claimed_at timestamptz,
  p_position integer,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_todo public.todos; v_error jsonb;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) or p_position is null or p_position<1
    or p_expected_updated_at is null or not isfinite(p_expected_updated_at) then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  v_error:=public.assignment_execution_error(v_row,p_claimed_at); if v_error is not null then return v_error; end if;
  select * into v_todo from public.todos where assignment_id=p_assignment_id and position=p_position;
  if not found then return public.assignment_error('not_found'); end if;
  if v_todo.updated_at<>p_expected_updated_at then return public.assignment_error('stale_update',jsonb_build_object('todo',to_jsonb(v_todo))); end if;
  if v_todo.status<>'todo' or exists(select 1 from public.todos where assignment_id=p_assignment_id
    and (status in ('in_progress','blocked') or position<p_position and status not in ('done','cancelled'))) then
    return public.assignment_error('invalid_transition',jsonb_build_object('todo',to_jsonb(v_todo)));
  end if;
  update public.todos set status='in_progress',updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where assignment_id=p_assignment_id and position=p_position returning * into v_todo;
  return jsonb_build_object('ok',true,'assignment',public.assignment_view(v_row),'todo',to_jsonb(v_todo));
end $$;

create function public.assignment_record_todo_result(p_project text,p_assignment_id text,p_claimed_at timestamptz,
  p_position integer,p_expected_updated_at timestamptz,p_outcome text,p_summary text,p_evidence text[],p_blocker text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_todo public.todos; v_error jsonb;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) or p_position is null or p_position<1
    or p_expected_updated_at is null or not isfinite(p_expected_updated_at) or p_outcome is null or p_outcome not in ('completed','blocked')
    or not public.assignment_nonblank(p_summary) or not public.assignment_valid_text_array(p_evidence,true)
    or (p_outcome='completed' and p_blocker is not null) or (p_outcome='blocked' and not public.assignment_nonblank(p_blocker)) then
    return public.assignment_error('invalid_input');
  end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  v_error:=public.assignment_execution_error(v_row,p_claimed_at); if v_error is not null then return v_error; end if;
  select * into v_todo from public.todos where assignment_id=p_assignment_id and position=p_position;
  if not found then return public.assignment_error('not_found'); end if;
  if v_todo.updated_at<>p_expected_updated_at then return public.assignment_error('stale_update',jsonb_build_object('todo',to_jsonb(v_todo))); end if;
  if v_todo.status<>'in_progress' then return public.assignment_error('invalid_transition',jsonb_build_object('todo',to_jsonb(v_todo))); end if;
  update public.todos set status=case p_outcome when 'completed' then 'done' else 'blocked' end,outcome=p_summary,evidence=p_evidence,blocker=p_blocker,
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where assignment_id=p_assignment_id and position=p_position returning * into v_todo;
  if p_outcome='blocked' then
    update public.assignments set status='blocked',blocker=p_blocker,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_assignment_id returning * into v_row;
  end if;
  return jsonb_build_object('ok',true,'assignment',public.assignment_view(v_row),'todo',to_jsonb(v_todo));
end $$;

create function public.assignment_block(p_project text,p_assignment_id text,p_claimed_at timestamptz,p_blocker text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_error jsonb;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) or not public.assignment_nonblank(p_blocker) then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  if v_row.status='blocked' and v_row.claimed_at=p_claimed_at and v_row.blocker=p_blocker then return jsonb_build_object('ok',true,'assignment',public.assignment_view(v_row)); end if;
  v_error:=public.assignment_execution_error(v_row,p_claimed_at); if v_error is not null then return v_error; end if;
  update public.todos set status='blocked',outcome=p_blocker,blocker=p_blocker,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where assignment_id=p_assignment_id and status='in_progress';
  update public.assignments set status='blocked',blocker=p_blocker,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_assignment_id returning * into v_row;
  return jsonb_build_object('ok',true,'assignment',public.assignment_view(v_row));
end $$;

create function public.assignment_finish(p_project text,p_assignment_id text,p_claimed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_error jsonb; v_unfinished jsonb;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  if v_row.status='done' and v_row.claimed_at=p_claimed_at then return jsonb_build_object('ok',true,'assignment',public.assignment_view(v_row)); end if;
  v_error:=public.assignment_execution_error(v_row,p_claimed_at); if v_error is not null then return v_error; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by position),'[]'::jsonb) into v_unfinished from public.todos t where assignment_id=p_assignment_id and status not in ('done','cancelled');
  if jsonb_array_length(v_unfinished)>0 then return public.assignment_error('unfinished_todos',jsonb_build_object('unfinished',v_unfinished)); end if;
  if not exists(select 1 from public.todos where assignment_id=p_assignment_id) then return public.assignment_error('invalid_transition',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
  update public.assignments set status='done',closed_at=clock_timestamp(),updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_assignment_id returning * into v_row;
  perform public.assignment_signal();
  return jsonb_build_object('ok',true,'assignment',public.assignment_view(v_row));
end $$;

create function public.assignment_reactivate(p_project text,p_assignment_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  if v_row.status in ('done','cancelled') then return public.assignment_error('assignment_closed',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
  if v_row.status<>'blocked' or exists(select 1 from public.todos where assignment_id=p_assignment_id and status in ('blocked','in_progress'))
    or not exists(select 1 from public.todos where assignment_id=p_assignment_id and status='todo') then return public.assignment_error('invalid_transition',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
  update public.assignments set status='active',claimed_at=null,lease_expired_at=null,blocker=null,
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_assignment_id returning * into v_row;
  perform public.assignment_signal();
  return public.assignment_detail(v_row);
end $$;

create or replace function public.assignment_notes(p_project text,p_assignment_id text,p_root text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_path text; v_root text;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  if v_row.status not in ('done','cancelled') then
    if p_root is not null then
      v_root:=case when p_root='/' then '' else regexp_replace(p_root,'/$','') end;
      if p_root !~ '^/' or p_root ~ '[\\[:cntrl:]]' or p_root ~ '(^|/)[.]{1,2}(/|$)' or p_root ~ '//' then return public.assignment_error('invalid_input'); end if;
      v_path:=v_root||'/projects/'||p_project||'/work/'||p_assignment_id||'/note.md';
      if v_row.notes_path is not null and v_row.notes_path<>v_path then return public.assignment_error('notes_path_conflict',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
      if v_row.notes_path is null then update public.assignments set notes_path=v_path,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_assignment_id returning * into v_row; end if;
    elsif v_row.notes_path is null then return public.assignment_error('notes_unprepared',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
  end if;
  return jsonb_build_object('ok',true,'assignment',public.assignment_view(v_row),'notes_path',v_row.notes_path,'editable',v_row.status not in ('done','cancelled'));
end $$;

create or replace function public.assignment_prepare_notes(p_project text,p_assignment_id text,p_root text)
returns jsonb language sql security definer set search_path='' as $$
  select case when p_root is null then public.assignment_error('invalid_input')
    else public.assignment_notes(p_project,p_assignment_id,p_root) end;
$$;

-- Newly created functions receive default PUBLIC execute; close it explicitly.
revoke all on function public.assignment_signal(),public.assignment_valid_target(text,text),
  public.assignment_valid_text_array(text[],boolean),public.assignment_error(text,jsonb),
  public.assignment_view(public.assignments),public.assignment_detail(public.assignments),
  public.assignment_execution_error(public.assignments,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.assignment_create(text,text,text[],text,text[]),
  public.assignment_update_todo(text,text,integer,timestamptz,text,text),public.assignment_claim(text,text),
  public.assignment_start_todo(text,text,timestamptz,integer,timestamptz),
  public.assignment_record_todo_result(text,text,timestamptz,integer,timestamptz,text,text,text[],text),
  public.assignment_block(text,text,timestamptz,text),public.assignment_finish(text,text,timestamptz),
  public.assignment_reactivate(text,text) from public,anon,authenticated;
grant execute on function public.assignment_create(text,text,text[],text,text[]),
  public.assignment_update_todo(text,text,integer,timestamptz,text,text),public.assignment_claim(text,text),
  public.assignment_start_todo(text,text,timestamptz,integer,timestamptz),
  public.assignment_record_todo_result(text,text,timestamptz,integer,timestamptz,text,text,text[],text),
  public.assignment_block(text,text,timestamptz,text),public.assignment_finish(text,text,timestamptz),
  public.assignment_reactivate(text,text) to service_role;

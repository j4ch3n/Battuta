-- Match ECMAScript whitespace so stored records remain valid MCP results.
create function public.assignment_nonblank(p_text text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(length(btrim(p_text, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0, false);
$$;
revoke all on function public.assignment_nonblank(text) from public, anon, authenticated, service_role;
create or replace function public.assignment_valid_project(p_project text)
returns boolean language sql immutable set search_path = '' as $$
  select public.assignment_nonblank(p_project)
    and p_project !~ '^[.]' and p_project !~ '[/\\[:cntrl:]]';
$$;
alter table public.assignments drop constraint assignments_goal_check;
alter table public.assignments add constraint assignments_goal_check check (public.assignment_nonblank(goal));
alter table public.todos drop constraint todos_description_check;
alter table public.todos add constraint todos_description_check check (public.assignment_nonblank(description));

create or replace function public.assignment_create(p_project text, p_goal text, p_constraints text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.assignments; v_constraint text;
begin
  if not public.assignment_valid_project(p_project) or not public.assignment_nonblank(p_goal) or p_constraints is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  for v_attempt in 1..100 loop
    begin
      insert into public.assignments(id, project, goal, constraints)
        values (left(gen_random_uuid()::text, 8), p_project, p_goal, p_constraints) returning * into v_row;
      return jsonb_build_object('ok', true, 'assignment', to_jsonb(v_row));
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'assignments_active_project' then
        select * into v_row from public.assignments where project = p_project and status = 'active';
        if found then return jsonb_build_object('ok', false, 'code', 'active_exists', 'assignment', to_jsonb(v_row)); end if;
      elsif v_constraint <> 'assignments_pkey' then raise;
      end if;
    end;
  end loop;
  return jsonb_build_object('ok', false, 'code', 'id_exhausted');
end $$;

create or replace function public.assignment_append_todos(p_project text, p_assignment_id text, p_descriptions text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.assignments; v_start integer; v_items jsonb;
begin
  if not public.assignment_valid_project(p_project) or p_assignment_id is null or p_assignment_id !~ '^[0-9a-f]{8}$'
    or p_descriptions is null or coalesce(array_length(p_descriptions,1),0) = 0
    or array_ndims(p_descriptions) <> 1
    or exists(select 1 from unnest(p_descriptions) d where not public.assignment_nonblank(d)) then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  select * into v_row from public.assignments where id=p_assignment_id and project=p_project for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if v_row.status <> 'active' then return jsonb_build_object('ok',false,'code','assignment_closed'); end if;
  select coalesce(max(position),0) into v_start from public.todos where assignment_id=p_assignment_id;
  with added as (
    insert into public.todos(assignment_id,position,description)
      select p_assignment_id, v_start + n::integer, d from unnest(p_descriptions) with ordinality as x(d,n)
      returning *
  ) select jsonb_agg(to_jsonb(added) order by position) into v_items from added;
  return jsonb_build_object('ok',true,'todos',v_items);
end $$;

create or replace function public.assignment_update_todo(p_project text, p_assignment_id text, p_position integer,
  p_expected_updated_at timestamptz, p_description text default null, p_status text default null, p_outcome text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_assignment public.assignments; v_item public.todos;
begin
  if not public.assignment_valid_project(p_project) or p_assignment_id is null or p_assignment_id !~ '^[0-9a-f]{8}$'
    or p_position is null or p_position < 1 or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or (p_description is null and p_status is null and p_outcome is null)
    or (p_description is not null and not public.assignment_nonblank(p_description))
    or (p_status is not null and p_status not in ('todo','in_progress','done','cancelled')) then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  select * into v_assignment from public.assignments where id=p_assignment_id and project=p_project for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if v_assignment.status <> 'active' then return jsonb_build_object('ok',false,'code','assignment_closed'); end if;
  select * into v_item from public.todos where assignment_id=p_assignment_id and position=p_position;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if v_item.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok',false,'code','stale_update','todo',to_jsonb(v_item));
  end if;
  update public.todos set description=coalesce(p_description,description), status=coalesce(p_status,status),
    outcome=coalesce(p_outcome,outcome), updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
    where assignment_id=p_assignment_id and position=p_position returning * into v_item;
  return jsonb_build_object('ok',true,'todo',to_jsonb(v_item));
end $$;

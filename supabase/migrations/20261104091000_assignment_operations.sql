create function public.assignment_append_todos(p_project text, p_assignment_id text, p_descriptions text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.assignments; v_start integer; v_items jsonb;
begin
  if not public.assignment_valid_project(p_project) or p_assignment_id is null or p_assignment_id !~ '^[0-9a-f]{8}$'
    or p_descriptions is null or coalesce(array_length(p_descriptions,1),0) = 0
    or array_ndims(p_descriptions) <> 1
    or exists(select 1 from unnest(p_descriptions) d where d is null or length(btrim(d)) = 0) then
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

create function public.assignment_update_todo(p_project text, p_assignment_id text, p_position integer,
  p_expected_updated_at timestamptz, p_description text default null, p_status text default null, p_outcome text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_assignment public.assignments; v_item public.todos;
begin
  if not public.assignment_valid_project(p_project) or p_assignment_id is null or p_assignment_id !~ '^[0-9a-f]{8}$'
    or p_position is null or p_position < 1 or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or (p_description is null and p_status is null and p_outcome is null)
    or (p_description is not null and length(btrim(p_description)) = 0)
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

create function public.assignment_close(p_project text, p_assignment_id text, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.assignments; v_unfinished jsonb;
begin
  if not public.assignment_valid_project(p_project) or p_assignment_id is null or p_assignment_id !~ '^[0-9a-f]{8}$'
    or p_status is null or p_status not in ('done','cancelled') then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  select * into v_row from public.assignments where id=p_assignment_id and project=p_project for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if v_row.status = p_status then return jsonb_build_object('ok',true,'assignment',to_jsonb(v_row)); end if;
  if v_row.status <> 'active' then return jsonb_build_object('ok',false,'code','assignment_closed'); end if;
  if p_status = 'done' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.position),'[]'::jsonb) into v_unfinished
      from public.todos t where assignment_id=p_assignment_id and status not in ('done','cancelled');
    if jsonb_array_length(v_unfinished) > 0 then return jsonb_build_object('ok',false,'code','unfinished_todos','unfinished',v_unfinished); end if;
  end if;
  update public.assignments set status=p_status, closed_at=clock_timestamp(), updated_at=clock_timestamp()
    where id=p_assignment_id returning * into v_row;
  return jsonb_build_object('ok',true,'assignment',to_jsonb(v_row));
end $$;

-- Shared lookup/preparation keeps frozen-state and path handling identical.
create function public.assignment_notes(p_project text, p_assignment_id text, p_root text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.assignments; v_path text; v_root text;
begin
  if not public.assignment_valid_project(p_project) or p_assignment_id is null or p_assignment_id !~ '^[0-9a-f]{8}$' then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  select * into v_row from public.assignments where id=p_assignment_id and project=p_project for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if v_row.status = 'active' then
    if p_root is not null then
      v_root := case when p_root = '/' then '' else regexp_replace(p_root, '/$', '') end;
      if p_root !~ '^/' or p_root ~ '[\\[:cntrl:]]' or p_root ~ '(^|/)[.]{1,2}(/|$)' or p_root ~ '//' then
        return jsonb_build_object('ok',false,'code','invalid_input');
      end if;
      v_path := v_root || '/projects/' || p_project || '/work/' || p_assignment_id || '/note.md';
      if v_row.notes_path is not null and v_row.notes_path <> v_path then
        return jsonb_build_object('ok',false,'code','notes_path_conflict');
      end if;
      if v_row.notes_path is null then
        update public.assignments set notes_path=v_path, updated_at=clock_timestamp()
          where id=p_assignment_id returning * into v_row;
      end if;
    elsif v_row.notes_path is null then return jsonb_build_object('ok',false,'code','notes_unprepared');
    end if;
  end if;
  return jsonb_build_object('ok',true,'assignment',to_jsonb(v_row),'notes_path',v_row.notes_path,'editable',v_row.status='active');
end $$;
revoke all on function public.assignment_notes(text,text,text) from public, anon, authenticated, service_role;

create function public.assignment_prepare_notes(p_project text, p_assignment_id text, p_root text)
returns jsonb language sql security definer set search_path = '' as $$
  select case when p_root is null then jsonb_build_object('ok',false,'code','invalid_input')
    else public.assignment_notes(p_project,p_assignment_id,p_root) end;
$$;
create function public.assignment_locate_notes(p_project text, p_assignment_id text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.assignment_notes(p_project,p_assignment_id,null);
$$;

revoke all on function public.assignment_append_todos(text,text,text[]),
 public.assignment_update_todo(text,text,integer,timestamptz,text,text,text), public.assignment_close(text,text,text),
 public.assignment_prepare_notes(text,text,text), public.assignment_locate_notes(text,text) from public, anon, authenticated;
grant execute on function public.assignment_append_todos(text,text,text[]),
 public.assignment_update_todo(text,text,integer,timestamptz,text,text,text), public.assignment_close(text,text,text),
 public.assignment_prepare_notes(text,text,text), public.assignment_locate_notes(text,text) to service_role;

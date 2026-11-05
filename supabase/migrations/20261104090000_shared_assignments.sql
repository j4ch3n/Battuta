create function public.assignment_valid_project(p_project text)
returns boolean language sql immutable set search_path = '' as $$
  select p_project is not null and length(btrim(p_project)) > 0
    and p_project !~ '^[.]' and p_project !~ '[/\\[:cntrl:]]';
$$;
revoke all on function public.assignment_valid_project(text) from public, anon, authenticated, service_role;

create table public.assignments (
  id text primary key check (id ~ '^[0-9a-f]{8}$'),
  project text not null check (public.assignment_valid_project(project)),
  goal text not null check (length(btrim(goal)) > 0),
  constraints text not null default '',
  status text not null default 'active' check (status in ('active', 'done', 'cancelled')),
  notes_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'active') = (closed_at is null))
);
create unique index assignments_active_project on public.assignments(project) where status = 'active';

create table public.todos (
  assignment_id text not null references public.assignments(id),
  position integer not null check (position > 0),
  description text not null check (length(btrim(description)) > 0),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  outcome text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (assignment_id, position)
);
alter table public.assignments enable row level security;
alter table public.todos enable row level security;
revoke all on public.assignments, public.todos from anon, authenticated, service_role;

create function public.assignment_create(p_project text, p_goal text, p_constraints text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.assignments; v_constraint text; v_attempt integer := 0;
begin
  if not public.assignment_valid_project(p_project) or p_goal is null or length(btrim(p_goal)) = 0 or p_constraints is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 100 then
      return jsonb_build_object('ok', false, 'code', 'id_exhausted');
    end if;
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
end $$;

create function public.assignment_list(p_project text, p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.assignment_valid_project(p_project) or (p_status is not null and p_status not in ('active','done','cancelled')) then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  return jsonb_build_object('ok', true, 'assignments', (
    select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc, a.id desc), '[]'::jsonb)
    from public.assignments a where a.project = p_project and (p_status is null or a.status = p_status)
  ));
end $$;

create function public.assignment_get(p_project text, p_assignment_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.assignments;
begin
  if not public.assignment_valid_project(p_project) or p_assignment_id is null or p_assignment_id !~ '^[0-9a-f]{8}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  select * into v_row from public.assignments where project = p_project and id = p_assignment_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'assignment', to_jsonb(v_row), 'todos', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.position), '[]'::jsonb) from public.todos t where t.assignment_id = p_assignment_id
  ));
end $$;

revoke all on function public.assignment_create(text,text,text), public.assignment_list(text,text), public.assignment_get(text,text) from public, anon, authenticated;
grant execute on function public.assignment_create(text,text,text), public.assignment_list(text,text), public.assignment_get(text,text) to service_role;

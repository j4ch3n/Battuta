-- The catalog is deliberately empty. Adding a specialist requires a reviewed
-- migration and a matching entry in assignments/abilities.json.
create function public.assignment_ability_catalog()
returns text[] language sql immutable set search_path='' as $$ select '{}'::text[] $$;

alter table public.assignments
  add column claimed_by text,
  add column require_abilities text[] not null default '{}',
  add constraint assignments_claimant_valid check (
    claimed_by is null or (public.assignment_nonblank(claimed_by) and claimed_at is not null)),
  add constraint assignments_abilities_valid check (
    require_abilities <@ public.assignment_ability_catalog()
    and array_position(require_abilities,null) is null);

create function public.assignment_ability_error(p_values text[])
returns jsonb language sql stable security definer set search_path='' as $$
  select case
    when p_values is null or array_position(p_values,null) is not null
      then public.assignment_error('invalid_input')
    when not (p_values <@ public.assignment_ability_catalog()) then jsonb_build_object(
      'ok',false,'code','unknown_abilities',
      'message','The specialist catalog is empty; only [] is currently valid for general work. Nothing was changed.',
      'unknown',(select jsonb_agg(name order by name) from (
        select distinct unnest(p_values) name
        except select unnest(public.assignment_ability_catalog())
      ) unknown_names),
      'suggestions','{}'::jsonb)
  end;
$$;

-- Retain the existing plan/execution implementations as private helpers.
-- Only the new entry points are executable by service_role.
alter function public.assignment_create(text,text,text[],text,text[]) rename to assignment_create_plan;
alter function public.assignment_claim(text,text) rename to assignment_claim_ready;
alter function public.assignment_start_todo(text,text,timestamptz,integer,timestamptz) rename to assignment_start_todo_owned;
alter function public.assignment_record_todo_result(text,text,timestamptz,integer,timestamptz,text,text,text[],text) rename to assignment_record_todo_result_owned;
alter function public.assignment_block(text,text,timestamptz,text) rename to assignment_block_owned;
alter function public.assignment_finish(text,text,timestamptz) rename to assignment_finish_owned;

create function public.assignment_create(p_project text,p_goal text,p_initial_todos text[],
  p_constraints text default '',p_depends_on_assignment_ids text[] default '{}',
  p_require_abilities text[] default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_error jsonb; v_row public.assignments;
begin
  v_error:=public.assignment_ability_error(p_require_abilities);
  if v_error is not null then return v_error; end if;
  v_result:=public.assignment_create_plan(p_project,p_goal,p_initial_todos,p_constraints,p_depends_on_assignment_ids);
  if not (v_result->>'ok')::boolean then return v_result; end if;
  update public.assignments set require_abilities=array(
    select distinct unnest(p_require_abilities) order by 1
  ) where id=v_result->'assignment'->>'id' returning * into v_row;
  return public.assignment_detail(v_row);
end $$;

create function public.assignment_claim(p_project text,p_assignment_id text,p_claimed_by text,p_abilities text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_error jsonb; v_result jsonb; v_missing text[];
begin
  if not public.assignment_valid_target(p_project,p_assignment_id)
    or not public.assignment_nonblank(p_claimed_by) then return public.assignment_error('invalid_input'); end if;
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
  update public.assignments set claimed_by=p_claimed_by where id=p_assignment_id returning * into v_row;
  return public.assignment_detail(v_row);
end $$;

-- Lock before checking both fences; old unidentified claims remain token-only.
create function public.assignment_claimant_error(p_project text,p_assignment_id text,
  p_claimed_at timestamptz,p_claimed_by text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id)
    or p_claimed_at is null or not isfinite(p_claimed_at) then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  if v_row.claimed_at is distinct from p_claimed_at or v_row.claimed_by is distinct from p_claimed_by then
    return public.assignment_error('stale_claim',jsonb_build_object('assignment',public.assignment_view(v_row)));
  end if;
  return null;
end $$;

create function public.assignment_start_todo(p_project text,p_assignment_id text,p_claimed_at timestamptz,
  p_position integer,p_expected_updated_at timestamptz,p_claimed_by text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_error jsonb;
begin
  v_error:=public.assignment_claimant_error(p_project,p_assignment_id,p_claimed_at,p_claimed_by);
  if v_error is not null then return v_error; end if;
  return public.assignment_start_todo_owned(p_project,p_assignment_id,p_claimed_at,p_position,p_expected_updated_at);
end $$;

create function public.assignment_record_todo_result(p_project text,p_assignment_id text,p_claimed_at timestamptz,
  p_position integer,p_expected_updated_at timestamptz,p_outcome text,p_summary text,p_evidence text[],
  p_blocker text default null,p_claimed_by text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_error jsonb;
begin
  v_error:=public.assignment_claimant_error(p_project,p_assignment_id,p_claimed_at,p_claimed_by);
  if v_error is not null then return v_error; end if;
  return public.assignment_record_todo_result_owned(p_project,p_assignment_id,p_claimed_at,
    p_position,p_expected_updated_at,p_outcome,p_summary,p_evidence,p_blocker);
end $$;

create function public.assignment_block(p_project text,p_assignment_id text,p_claimed_at timestamptz,
  p_blocker text,p_claimed_by text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_error jsonb;
begin
  v_error:=public.assignment_claimant_error(p_project,p_assignment_id,p_claimed_at,p_claimed_by);
  if v_error is not null then return v_error; end if;
  return public.assignment_block_owned(p_project,p_assignment_id,p_claimed_at,p_blocker);
end $$;

create function public.assignment_finish(p_project text,p_assignment_id text,p_claimed_at timestamptz,
  p_claimed_by text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_error jsonb;
begin
  v_error:=public.assignment_claimant_error(p_project,p_assignment_id,p_claimed_at,p_claimed_by);
  if v_error is not null then return v_error; end if;
  return public.assignment_finish_owned(p_project,p_assignment_id,p_claimed_at);
end $$;

create or replace function public.assignment_reactivate(p_project text,p_assignment_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) then return public.assignment_error('invalid_input'); end if;
  select * into v_row from public.assignments where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  if v_row.status in ('done','cancelled') then return public.assignment_error('assignment_closed',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
  if v_row.status<>'blocked' or exists(select 1 from public.todos where assignment_id=p_assignment_id and status in ('blocked','in_progress'))
    or not exists(select 1 from public.todos where assignment_id=p_assignment_id and status='todo') then return public.assignment_error('invalid_transition',jsonb_build_object('assignment',public.assignment_view(v_row))); end if;
  update public.assignments set status='active',claimed_by=null,claimed_at=null,lease_expired_at=null,blocker=null,
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_assignment_id returning * into v_row;
  perform public.assignment_signal();
  return public.assignment_detail(v_row);
end $$;

revoke all on function
  public.assignment_create_plan(text,text,text[],text,text[]),
  public.assignment_claim_ready(text,text),
  public.assignment_start_todo_owned(text,text,timestamptz,integer,timestamptz),
  public.assignment_record_todo_result_owned(text,text,timestamptz,integer,timestamptz,text,text,text[],text),
  public.assignment_block_owned(text,text,timestamptz,text),
  public.assignment_finish_owned(text,text,timestamptz),
  public.assignment_ability_catalog(),public.assignment_ability_error(text[]),
  public.assignment_claimant_error(text,text,timestamptz,text)
  from public,anon,authenticated,service_role;

revoke all on function
  public.assignment_create(text,text,text[],text,text[],text[]),
  public.assignment_claim(text,text,text,text[]),
  public.assignment_start_todo(text,text,timestamptz,integer,timestamptz,text),
  public.assignment_record_todo_result(text,text,timestamptz,integer,timestamptz,text,text,text[],text,text),
  public.assignment_block(text,text,timestamptz,text,text),
  public.assignment_finish(text,text,timestamptz,text)
  from public,anon,authenticated;

grant execute on function
  public.assignment_create(text,text,text[],text,text[],text[]),
  public.assignment_claim(text,text,text,text[]),
  public.assignment_start_todo(text,text,timestamptz,integer,timestamptz,text),
  public.assignment_record_todo_result(text,text,timestamptz,integer,timestamptz,text,text,text[],text,text),
  public.assignment_block(text,text,timestamptz,text,text),
  public.assignment_finish(text,text,timestamptz,text)
  to service_role;

create or replace function public.assignment_ability_catalog()
returns text[] language sql immutable set search_path='' as $$
  select array['research','mobile-control']::text[]
$$;

alter table public.assignments alter column require_abilities set default array['research']::text[];
update public.assignments set require_abilities=array['research']::text[];
alter table public.assignments add constraint assignments_abilities_nonempty
  check (cardinality(require_abilities)>0);

create or replace function public.assignment_ability_error(p_values text[])
returns jsonb language sql stable security definer set search_path='' as $$
  select case
    when p_values is null or array_position(p_values,null) is not null
      then public.assignment_error('invalid_input')
    when not (p_values <@ public.assignment_ability_catalog()) then jsonb_build_object(
      'ok',false,'code','unknown_abilities',
      'message','Unknown specialist abilities. Nothing was changed.',
      'unknown',(select jsonb_agg(name order by name) from (
        select distinct unnest(p_values) name
        except select unnest(public.assignment_ability_catalog())
      ) unknown_names),
      'suggestions','{}'::jsonb)
  end;
$$;

create or replace function public.assignment_create(p_project text,p_goal text,p_initial_todos text[],
  p_constraints text default '',p_depends_on_assignment_ids text[] default '{}',
  p_require_abilities text[] default array['research']::text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_error jsonb; v_row public.assignments;
begin
  v_error:=public.assignment_ability_error(p_require_abilities);
  if v_error is not null then return v_error; end if;
  if cardinality(p_require_abilities)=0 then return public.assignment_error('invalid_input'); end if;
  v_result:=public.assignment_create_plan(p_project,p_goal,p_initial_todos,p_constraints,p_depends_on_assignment_ids);
  if not (v_result->>'ok')::boolean then return v_result; end if;
  update public.assignments set require_abilities=array(
    select distinct unnest(p_require_abilities) order by 1
  ) where id=v_result->'assignment'->>'id' returning * into v_row;
  return public.assignment_detail(v_row);
end $$;

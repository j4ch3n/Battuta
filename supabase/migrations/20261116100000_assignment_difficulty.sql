create type public.assignment_difficulty as enum ('easy','medium','hard','hail_mary');
alter table public.assignments
  add column difficulty public.assignment_difficulty not null default 'easy';

drop function public.assignment_create(text,text,text[],text,text[],text[]);
create function public.assignment_create(p_project text,p_goal text,p_initial_todos text[],
  p_constraints text default '',p_depends_on_assignment_ids text[] default '{}',
  p_require_abilities text[] default array['research']::text[],
  p_difficulty public.assignment_difficulty default 'easy')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_error jsonb; v_row public.assignments;
begin
  v_error:=public.assignment_ability_error(p_require_abilities);
  if v_error is not null then return v_error; end if;
  if cardinality(p_require_abilities)=0 or p_difficulty is null then
    return public.assignment_error('invalid_input'); end if;
  v_result:=public.assignment_create_plan(p_project,p_goal,p_initial_todos,p_constraints,p_depends_on_assignment_ids);
  if not (v_result->>'ok')::boolean then return v_result; end if;
  update public.assignments set require_abilities=array(
    select distinct unnest(p_require_abilities) order by 1
  ),difficulty=p_difficulty where id=v_result->'assignment'->>'id' returning * into v_row;
  return public.assignment_detail(v_row);
end $$;

revoke all on function public.assignment_create(text,text,text[],text,text[],text[],public.assignment_difficulty)
  from public,anon,authenticated;
grant execute on function public.assignment_create(text,text,text[],text,text[],text[],public.assignment_difficulty)
  to service_role;

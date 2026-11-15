-- Shared note identity is host-neutral. Existing absolute metadata is retained,
-- never used as another host's local write destination.
create function public.assignment_notes_ref(p_project text,p_assignment_id text,p_prepare boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.assignments; v_ref text;
begin
  if not public.assignment_valid_target(p_project,p_assignment_id) then
    return public.assignment_error('invalid_input');
  end if;
  select * into v_row from public.assignments
    where project=p_project and id=p_assignment_id for update;
  if not found then return public.assignment_error('not_found'); end if;
  v_ref:='projects/'||p_project||'/work/'||p_assignment_id||'/note.md';
  if v_row.status not in ('done','cancelled') and v_row.notes_path is null then
    if not p_prepare then
      return public.assignment_error('notes_unprepared',jsonb_build_object('assignment',public.assignment_view(v_row)));
    end if;
    update public.assignments set notes_path=v_ref,
      updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
      where id=p_assignment_id returning * into v_row;
  end if;
  return jsonb_build_object('ok',true,'assignment',public.assignment_view(v_row),
    'notes_ref',case when v_row.notes_path is null then null else v_ref end,
    'editable',v_row.status not in ('done','cancelled'));
end $$;

create function public.assignment_prepare_notes(p_project text,p_assignment_id text)
returns jsonb language sql security definer set search_path='' as $$
  select public.assignment_notes_ref(p_project,p_assignment_id,true);
$$;
create or replace function public.assignment_locate_notes(p_project text,p_assignment_id text)
returns jsonb language sql security definer set search_path='' as $$
  select public.assignment_notes_ref(p_project,p_assignment_id,false);
$$;
drop function public.assignment_prepare_notes(text,text,text);
drop function public.assignment_notes(text,text,text);
revoke all on function public.assignment_notes_ref(text,text,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.assignment_prepare_notes(text,text),public.assignment_locate_notes(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.assignment_prepare_notes(text,text),public.assignment_locate_notes(text,text)
  to service_role;

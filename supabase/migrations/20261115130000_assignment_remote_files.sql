insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assignment-files', 'assignment-files', false, 50000000, null);

create function public.assignment_remote_files_exists(p_assignment_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_assignment_id is null or p_assignment_id !~ '^[0-9a-f]{8}$' then
    raise exception 'Invalid assignment ID' using errcode = '22023';
  end if;
  return exists (select 1 from public.assignments where id = p_assignment_id);
end;
$$;

revoke all on function public.assignment_remote_files_exists(text) from public, anon, authenticated;
grant execute on function public.assignment_remote_files_exists(text) to service_role;

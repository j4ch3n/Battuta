-- Agent mail checks that a worker follow-up names an assignment that worker claimed.
-- The ID is only matched, never parsed: an unknown value finds no claimant.
create function public.agent_mail_assignment_claimant(p_assignment_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select claimed_by from public.assignments where id = p_assignment_id;
$$;

revoke all on function public.agent_mail_assignment_claimant(text) from public, anon, authenticated;
grant execute on function public.agent_mail_assignment_claimant(text) to service_role;

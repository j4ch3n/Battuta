create or replace function public.assignment_view(p_row public.assignments)
returns jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(p_row) || jsonb_build_object(
    'dependencies',coalesce((select jsonb_agg(jsonb_build_object(
      'assignment_id',a.id,'project',a.project,'status',a.status) order by a.id)
      from public.assignment_dependencies d join public.assignments a on a.id=d.prerequisite_assignment_id
      where d.assignment_id=p_row.id),'[]'::jsonb),
    'lease_expired',p_row.status='in_process' and p_row.lease_expired_at<now(),
    'ready',p_row.status='active' and p_row.claimed_at is null
      and not exists(select 1 from public.assignment_dependencies d join public.assignments a
        on a.id=d.prerequisite_assignment_id where d.assignment_id=p_row.id and a.status<>'done')
      and exists(select 1 from public.todos where assignment_id=p_row.id and status='todo')
      and not exists(select 1 from public.todos where assignment_id=p_row.id and status in ('blocked','in_progress')));
$$;

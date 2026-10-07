-- Exact-task admission for opt-in smoke. Preserve the ordinary two-argument
-- queue claim and its oldest-compatible-row scheduling semantics unchanged.
create function public.task_pool_claim(p_worker_id text,p_projects text[],p_task_id uuid)
returns public.tasks_pool language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks_pool;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' or p_projects is null or cardinality(p_projects)=0 or p_task_id is null then raise exception 'Invalid task request' using errcode='22023'; end if;
  select * into v_task from public.tasks_pool where id=p_task_id and project=any(p_projects) and claimed_by is null for update skip locked;
  if not found then return null; end if;
  update public.tasks_pool set claimed_by=p_worker_id,claimed_at=now() where id=v_task.id returning * into v_task;
  return v_task;
end $$;
revoke all on function public.task_pool_claim(text,text[],uuid) from public,anon,authenticated;
grant execute on function public.task_pool_claim(text,text[],uuid) to service_role;

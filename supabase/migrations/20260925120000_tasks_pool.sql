-- Delegation and stable ownership only; independent Executors own their runtime.
create table public.tasks_pool (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) > 0),
  project text not null check (length(btrim(project)) > 0),
  ticket_id text not null check (length(btrim(ticket_id)) > 0),
  role text not null default 'executor' check (length(btrim(role)) > 0),
  instruction text not null check (length(btrim(instruction)) > 0),
  status text not null default 'queued' check (status in ('queued', 'claimed', 'completed', 'failed')),
  claimed_by text check (length(btrim(claimed_by)) > 0),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  constraint tasks_pool_lifecycle check (
    (status = 'queued' and claimed_by is null and claimed_at is null and completed_at is null and failed_at is null) or
    (status = 'claimed' and claimed_by is not null and claimed_at is not null and completed_at is null and failed_at is null) or
    (status = 'completed' and claimed_by is not null and claimed_at is not null and completed_at is not null and failed_at is null) or
    (status = 'failed' and claimed_by is not null and claimed_at is not null and completed_at is null and failed_at is not null)
  )
);
create index tasks_pool_queued on public.tasks_pool (role, created_at, id) where status = 'queued';
create unique index tasks_pool_worker_claim on public.tasks_pool (claimed_by) where status = 'claimed';

alter table public.tasks_pool enable row level security;
revoke all on public.tasks_pool from public, anon, authenticated, service_role;
grant select on public.tasks_pool to service_role;

create function public.delegate_task(p_key text, p_project text, p_ticket_id text,
  p_role text default 'executor', p_instruction text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks_pool;
begin
  -- The unique constraint serializes concurrent submissions of the same key.
  insert into public.tasks_pool (idempotency_key, project, ticket_id, role, instruction)
    values (p_key, p_project, p_ticket_id, p_role, p_instruction)
    on conflict (idempotency_key) do nothing returning * into v_task;
  if not found then
    -- At the default READ COMMITTED isolation level, this separate statement
    -- sees the winning insert after ON CONFLICT has waited for its transaction.
    select * into strict v_task from public.tasks_pool where idempotency_key = p_key;
    if v_task.project is distinct from p_project or v_task.ticket_id is distinct from p_ticket_id
       or v_task.role is distinct from p_role or v_task.instruction is distinct from p_instruction then
      raise exception 'idempotency key reused with different payload';
    end if;
  end if;
  return to_jsonb(v_task);
end $$;

create function public.claim_task(p_worker_id text, p_role text default 'executor')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks_pool;
begin
  if p_worker_id is null or length(btrim(p_worker_id)) = 0
     or p_role is null or length(btrim(p_role)) = 0 then
    raise exception 'worker_id and role must be nonempty';
  end if;
  -- Transaction-only serialization for duplicate requests by one worker, not a
  -- lease or runtime lock. Hash collisions merely serialize unrelated requests.
  perform pg_advisory_xact_lock(hashtextextended(p_worker_id, 40250925));
  select * into v_task from public.tasks_pool
    where claimed_by = p_worker_id and status = 'claimed' for update;
  if found then return to_jsonb(v_task); end if;

  select * into v_task from public.tasks_pool
    where status = 'queued' and role = p_role
    order by created_at, id limit 1 for update skip locked;
  if not found then return 'null'::jsonb; end if;
  update public.tasks_pool set status = 'claimed', claimed_by = p_worker_id, claimed_at = clock_timestamp()
    where id = v_task.id returning * into v_task;
  return to_jsonb(v_task);
end $$;

create function public.complete_task(p_worker_id text, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks_pool;
begin
  -- The conditional UPDATE locks/rechecks the row, so competing terminal
  -- transitions cannot both succeed (including complete versus fail).
  update public.tasks_pool set status = 'completed', completed_at = clock_timestamp()
    where id = p_task_id and claimed_by = p_worker_id and status = 'claimed'
    returning * into v_task;
  if not found then raise exception 'task is not claimed by this worker'; end if;
  return to_jsonb(v_task);
end $$;

create function public.fail_task(p_worker_id text, p_task_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks_pool;
begin
  -- V1 accepts the reason but deliberately does not persist it.
  update public.tasks_pool set status = 'failed', failed_at = clock_timestamp()
    where id = p_task_id and claimed_by = p_worker_id and status = 'claimed'
    returning * into v_task;
  if not found then raise exception 'task is not claimed by this worker'; end if;
  return to_jsonb(v_task);
end $$;

revoke all on function public.delegate_task(text,text,text,text,text), public.claim_task(text,text),
  public.complete_task(text,uuid), public.fail_task(text,uuid,text) from public, anon, authenticated;
grant execute on function public.delegate_task(text,text,text,text,text), public.claim_task(text,text),
  public.complete_task(text,uuid), public.fail_task(text,uuid,text) to service_role;

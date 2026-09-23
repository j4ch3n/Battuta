create extension if not exists pgmq;

do $$
begin
  if to_regclass('pgmq.q_engineer_tasks') is null then
    perform pgmq.create('engineer_tasks');
  end if;
end $$;

create table if not exists public.linear_issue_dispatches (
  issue_id text primary key,
  queue_message_id bigint not null,
  queued_at timestamptz not null default now()
);

alter table public.linear_issue_dispatches enable row level security;

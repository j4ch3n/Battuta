create extension if not exists pgmq;

select pgmq.create('engineer_tasks');

create table public.linear_issue_dispatches (
  issue_id text primary key,
  queue_message_id bigint not null,
  queued_at timestamptz not null default now()
);

alter table public.linear_issue_dispatches enable row level security;

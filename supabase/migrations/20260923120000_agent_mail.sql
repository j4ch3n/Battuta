-- Local PostgREST exposes pgmq_public even on pgmq versions that do not create it.
create schema if not exists pgmq_public;

-- Pi's stable --session-id is the mail address. No role registry is needed;
-- the trusted runner derives its own address from Pi's session context.
create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  sender text not null check (sender ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  recipient text not null check (recipient ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  body text not null check (length(btrim(body)) > 0 and length(body) <= 16000),
  status text not null default 'created' check (status in ('created', 'read', 'replied')),
  conversation_id uuid not null,
  in_reply_to uuid references public.agent_messages(id),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  replied_at timestamptz,
  constraint different_agent_sessions check (sender <> recipient),
  constraint valid_message_times check (
    (status = 'created' and read_at is null and replied_at is null) or
    (status = 'read' and read_at is not null and replied_at is null) or
    (status = 'replied' and read_at is not null and replied_at is not null)
  ),
  unique (sender, idempotency_key),
  -- One direct reply per row; further dialogue replies to the newest row.
  unique (in_reply_to)
);
create index agent_messages_inbox on public.agent_messages (recipient, status, created_at, id);
create index agent_messages_sender_outstanding on public.agent_messages (sender, status, created_at);
create index agent_messages_reply_target on public.agent_messages (in_reply_to) where in_reply_to is not null;

create table public.agent_mail_leases (
  identity text primary key,
  owner uuid not null,
  expires_at timestamptz not null
);
create table public.agent_mail_chases (
  message_id uuid not null references public.agent_messages(id),
  status text not null check (status in ('created', 'read')),
  interval_number integer not null check (interval_number > 0),
  notified_at timestamptz not null default now(),
  primary key (message_id, status, interval_number)
);

alter table public.agent_messages enable row level security;
alter table public.agent_mail_leases enable row level security;
alter table public.agent_mail_chases enable row level security;
revoke all on public.agent_messages, public.agent_mail_leases,
  public.agent_mail_chases from anon, authenticated;
-- Secret keys use service_role and bypass RLS. Keep them only on trusted hosts.
grant all on public.agent_messages, public.agent_mail_leases,
  public.agent_mail_chases to service_role;

create function public.agent_mail_send_session(p_sender text, p_recipient text, p_body text, p_key uuid, p_in_reply_to uuid default null)
returns public.agent_messages language plpgsql security definer set search_path = '' as $$
declare v_parent public.agent_messages; v_row public.agent_messages;
begin
  if p_sender is null or p_recipient is null or p_sender = p_recipient or p_key is null
     or p_sender !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
     or p_recipient !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
     or p_body is null or length(btrim(p_body)) = 0 or length(p_body) > 16000 then
    raise exception 'invalid agent mail arguments';
  end if;
  select * into v_row from public.agent_messages where sender = p_sender and idempotency_key = p_key;
  if found then
    if v_row.recipient <> p_recipient or v_row.body <> p_body or v_row.in_reply_to is distinct from p_in_reply_to then
      raise exception 'idempotency key reused with different payload';
    end if;
    return v_row;
  end if;
  if p_in_reply_to is not null then
    select * into v_parent from public.agent_messages where id = p_in_reply_to for update;
    if not found or v_parent.sender <> p_recipient or v_parent.recipient <> p_sender
       or v_parent.status <> 'read' then
      raise exception 'invalid or already answered reply target';
    end if;
  end if;
  insert into public.agent_messages (sender, recipient, body, conversation_id, in_reply_to, idempotency_key)
    values (p_sender, p_recipient, p_body, coalesce(v_parent.conversation_id, gen_random_uuid()), p_in_reply_to, p_key)
    returning * into v_row;
  if p_in_reply_to is not null then
    update public.agent_messages set status = 'replied', replied_at = now() where id = p_in_reply_to;
  end if;
  return v_row;
exception when unique_violation then
  select * into v_row from public.agent_messages where sender = p_sender and idempotency_key = p_key;
  if found and v_row.recipient = p_recipient and v_row.body = p_body
     and v_row.in_reply_to is not distinct from p_in_reply_to then return v_row; end if;
  raise;
end $$;

create function public.agent_mail_lease_session(p_session text, p_owner uuid, p_release boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_owner is null or p_session is null or p_session !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' then
    raise exception 'invalid runner session';
  end if;
  if p_release then
    delete from public.agent_mail_leases where identity = p_session and owner = p_owner;
    return true;
  end if;
  insert into public.agent_mail_leases (identity, owner, expires_at)
    values (p_session, p_owner, now() + interval '30 seconds')
  on conflict (identity) do update set owner = excluded.owner, expires_at = excluded.expires_at
    where public.agent_mail_leases.owner = excluded.owner or public.agent_mail_leases.expires_at < now();
  return exists (select 1 from public.agent_mail_leases where identity = p_session and owner = p_owner and expires_at > now());
end $$;

create function public.agent_mail_read_session(p_session text, p_id uuid, p_owner uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.agent_mail_leases where identity = p_session
       and owner = p_owner and expires_at > now()) then raise exception 'inbox lease lost'; end if;
  update public.agent_messages set status = 'read', read_at = now()
    where id = p_id and recipient = p_session and status = 'created';
  return found;
end $$;

create function public.agent_mail_due_session(p_session text, p_deadline_seconds integer, p_interval_seconds integer)
returns table (message_id uuid, elapsed_seconds integer, current_status text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_session is null or p_session !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
     or p_deadline_seconds < 1 or p_interval_seconds < 1 then raise exception 'invalid chase request'; end if;
  return query
  with due as (
    select m.id, m.status, extract(epoch from now() - coalesce(m.read_at, m.created_at))::integer as elapsed,
      (1 + floor((extract(epoch from now() - coalesce(m.read_at, m.created_at)) - p_deadline_seconds) / p_interval_seconds))::integer as slot
    from public.agent_messages m where m.sender = p_session and m.status in ('created', 'read')
  ), claimed as (
    insert into public.agent_mail_chases (message_id, status, interval_number)
      select d.id, d.status, d.slot from due d where d.elapsed >= p_deadline_seconds and d.slot > 0
      on conflict do nothing returning public.agent_mail_chases.message_id
  )
  select d.id, d.elapsed, d.status from due d join claimed c on c.message_id = d.id;
end $$;

revoke all on function public.agent_mail_send_session(text,text,text,uuid,uuid),
  public.agent_mail_lease_session(text,uuid,boolean), public.agent_mail_read_session(text,uuid,uuid),
  public.agent_mail_due_session(text,integer,integer) from public;
grant execute on function public.agent_mail_send_session(text,text,text,uuid,uuid),
  public.agent_mail_lease_session(text,uuid,boolean), public.agent_mail_read_session(text,uuid,uuid),
  public.agent_mail_due_session(text,integer,integer) to service_role;

alter publication supabase_realtime add table public.agent_messages;

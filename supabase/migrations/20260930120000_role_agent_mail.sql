-- Mail tables are empty. Replace session routing, inbox locks and chase claims.
drop function public.agent_mail_due_session(text, integer, integer);
drop function public.agent_mail_read_session(text, uuid, uuid);
drop function public.agent_mail_lease_session(text, uuid, boolean);
drop function public.agent_mail_send_session(text, text, text, uuid, uuid);
drop table public.agent_mail_chases;
drop table public.agent_mail_leases;
drop table public.agent_messages;

create type public.agent_message_type as enum ('chat', 'chase');

create table public.agent_messages (
  conversation_id uuid not null,
  id text not null check (id ~ '^[a-f0-9]{12}$'),
  sender text not null check (sender ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  recipient text not null check (recipient ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  message_type public.agent_message_type not null default 'chat',
  content jsonb not null check (
    jsonb_typeof(content) = 'object' and jsonb_typeof(content->'content') is not distinct from 'string'
    and length(btrim(content->>'content')) between 1 and 16000
    and content - 'content' = '{}'::jsonb
  ),
  status text not null default 'created' check (status in ('created', 'read', 'replied')),
  in_reply_to text,
  response_due timestamptz,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  replied_at timestamptz,
  primary key (conversation_id, id),
  foreign key (conversation_id, in_reply_to) references public.agent_messages(conversation_id, id),
  unique (conversation_id, in_reply_to),
  check (sender <> recipient),
  check (in_reply_to is null or in_reply_to <> id),
  check (response_due is null or response_due > created_at),
  check (
    (status = 'created' and read_at is null and replied_at is null) or
    (status = 'read' and read_at is not null and replied_at is null) or
    (status = 'replied' and read_at is not null and replied_at is not null)
  )
);
create index agent_messages_inbox on public.agent_messages (recipient, status, created_at, conversation_id, id);
create index agent_messages_response_due on public.agent_messages (response_due)
  where response_due is not null and status in ('created', 'read');

alter table public.agent_messages enable row level security;
revoke all on public.agent_messages from anon, authenticated;
grant all on public.agent_messages to service_role;

-- Internal insert helper. Only the public send/reply RPCs can invoke it.
create function public.agent_mail_store(
  p_sender_role text, p_recipient_role text, p_conversation_id uuid,
  p_message_type public.agent_message_type, p_content jsonb,
  p_response_due_minutes integer, p_in_reply_to text default null
) returns public.agent_messages language plpgsql set search_path = '' as $$
declare v_row public.agent_messages; v_created_at timestamptz := now(); v_id text;
begin
  if p_sender_role is null or p_recipient_role is null or p_sender_role = p_recipient_role
     or p_sender_role !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
     or p_recipient_role !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
     or p_conversation_id is null or p_message_type is null or p_content is null
     or jsonb_typeof(p_content) <> 'object'
     or jsonb_typeof(p_content->'content') is distinct from 'string'
     or length(btrim(p_content->>'content')) not between 1 and 16000
     or p_content - 'content' <> '{}'::jsonb
     or (p_response_due_minutes is not null and p_response_due_minutes not in (5, 10, 20)) then
    raise exception 'invalid agent mail arguments' using errcode = '22023';
  end if;
  loop
    v_id := substr(md5(gen_random_uuid()::text), 1, 12);
    if v_id = p_in_reply_to then continue; end if;
    insert into public.agent_messages (
      conversation_id, id, sender, recipient, message_type, content,
      in_reply_to, created_at, response_due
    ) values (
      p_conversation_id, v_id,
      p_sender_role, p_recipient_role, p_message_type, p_content,
      p_in_reply_to, v_created_at,
      case when p_response_due_minutes is null then null
        else v_created_at + make_interval(mins => p_response_due_minutes) end
    ) on conflict (conversation_id, id) do nothing returning * into v_row;
    if found then exit; end if;
  end loop;
  return v_row;
end $$;

create function public.agent_mail_send(
  p_sender_role text, p_recipient_role text, p_conversation_id uuid,
  p_message_type public.agent_message_type, p_content jsonb, p_response_due_minutes integer
) returns public.agent_messages language sql security definer set search_path = '' as $$
  select public.agent_mail_store(p_sender_role, p_recipient_role, p_conversation_id,
    p_message_type, p_content, p_response_due_minutes);
$$;

create function public.agent_mail_reply(
  p_sender_role text, p_parent_conversation_id uuid, p_parent_id text,
  p_message_type public.agent_message_type, p_content jsonb, p_response_due_minutes integer
) returns public.agent_messages language plpgsql security definer set search_path = '' as $$
declare v_parent public.agent_messages; v_row public.agent_messages;
begin
  select * into v_parent from public.agent_messages
    where conversation_id = p_parent_conversation_id and id = p_parent_id for update;
  if not found or p_sender_role is null or v_parent.recipient <> p_sender_role or v_parent.status <> 'read' then
    raise exception 'invalid or already answered reply target' using errcode = '22023';
  end if;
  v_row := public.agent_mail_store(p_sender_role, v_parent.sender, v_parent.conversation_id,
    p_message_type, p_content, p_response_due_minutes, v_parent.id);
  update public.agent_messages set status = 'replied', replied_at = now()
    where conversation_id = v_parent.conversation_id and id = v_parent.id;
  return v_row;
end $$;

create function public.agent_mail_read(p_recipient_role text, p_conversation_id uuid, p_message_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.agent_messages set status = 'read', read_at = now()
    where conversation_id = p_conversation_id and id = p_message_id
      and recipient = p_recipient_role and status = 'created';
  return found;
end $$;

revoke all on function public.agent_mail_store(text,text,uuid,public.agent_message_type,jsonb,integer,text) from public, anon, authenticated, service_role;
revoke all on function public.agent_mail_send(text,text,uuid,public.agent_message_type,jsonb,integer),
  public.agent_mail_reply(text,uuid,text,public.agent_message_type,jsonb,integer),
  public.agent_mail_read(text,uuid,text) from public, anon, authenticated;
grant execute on function public.agent_mail_send(text,text,uuid,public.agent_message_type,jsonb,integer),
  public.agent_mail_reply(text,uuid,text,public.agent_message_type,jsonb,integer),
  public.agent_mail_read(text,uuid,text) to service_role;

alter publication supabase_realtime add table public.agent_messages;

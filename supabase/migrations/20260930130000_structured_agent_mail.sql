-- The Pi adapter owns the message-content contract. Supabase only stores JSON.
alter table public.agent_messages drop constraint agent_messages_content_check;
alter table public.agent_messages add constraint agent_messages_content_check
  check (jsonb_typeof(content) = 'object');

create or replace function public.agent_mail_store(
  p_sender_role text, p_recipient_role text, p_conversation_id uuid,
  p_message_type public.agent_message_type, p_content jsonb,
  p_response_due_minutes integer, p_in_reply_to text default null
) returns public.agent_messages language plpgsql set search_path = '' as $$
declare v_row public.agent_messages; v_created_at timestamptz := now(); v_id text;
begin
  if p_sender_role is null or p_recipient_role is null or p_sender_role = p_recipient_role
     or p_sender_role !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' or p_recipient_role !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
     or p_conversation_id is null or p_message_type is null or p_content is null
     or jsonb_typeof(p_content) <> 'object'
     or (p_response_due_minutes is not null and p_response_due_minutes not in (5, 10, 20)) then
    raise exception 'invalid agent mail arguments' using errcode = '22023';
  end if;
  loop
    v_id := substr(md5(gen_random_uuid()::text), 1, 12);
    if v_id = p_in_reply_to then continue; end if;
    insert into public.agent_messages (
      conversation_id, id, sender, recipient, message_type, content, in_reply_to, created_at, response_due
    ) values (
      p_conversation_id, v_id, p_sender_role, p_recipient_role, p_message_type, p_content, p_in_reply_to, v_created_at,
      case when p_response_due_minutes is null then null else v_created_at + make_interval(mins => p_response_due_minutes) end
    ) on conflict (conversation_id, id) do nothing returning * into v_row;
    if found then exit; end if;
  end loop;
  return v_row;
end $$;

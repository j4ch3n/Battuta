begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

select ok((select relrowsecurity from pg_class where oid = 'public.agent_messages'::regclass),
  'mail table has RLS enabled');
select ok(not has_table_privilege('anon', 'public.agent_messages', 'SELECT'),
  'anonymous users cannot read mail');
select ok(not has_table_privilege('authenticated', 'public.agent_messages', 'INSERT'),
  'authenticated users cannot write mail');
select ok(has_table_privilege('service_role', 'public.agent_messages', 'SELECT'),
  'service role can read mail');
select ok(not has_function_privilege('anon',
  'public.agent_mail_send(text,text,uuid,public.agent_message_type,jsonb,integer,text)', 'EXECUTE'),
  'anonymous users cannot send through RPC');
select ok(not has_function_privilege('authenticated',
  'public.agent_mail_reply(text,uuid,text,public.agent_message_type,jsonb,integer)', 'EXECUTE'),
  'authenticated users cannot reply through RPC');
select ok(has_function_privilege('service_role',
  'public.agent_mail_send(text,text,uuid,public.agent_message_type,jsonb,integer,text)', 'EXECUTE'),
  'service role can send through RPC');
select ok(not has_function_privilege('service_role',
  'public.agent_mail_store(text,text,uuid,public.agent_message_type,jsonb,integer,text,text)', 'EXECUTE'),
  'service role cannot bypass public RPCs through the internal store');

select is((public.agent_mail_send('manager-bot','worker-1',gen_random_uuid(),'chat','{}'::jsonb,null)).delivery,
  'queue', 'delivery defaults to queue');
select is((public.agent_mail_send('manager-bot','worker-1',gen_random_uuid(),'chat','{}'::jsonb,null,'steer')).delivery,
  'steer', 'steer delivery is stored');
select throws_ok($$select public.agent_mail_send('manager-bot','worker-1',gen_random_uuid(),'chat','{}'::jsonb,null,'now')$$,
  '22023', 'invalid agent mail arguments', 'unknown delivery refused');
select is((select count(*) from public.agent_messages where recipient = 'worker-1'), 2::bigint,
  'bot-name mailboxes are accepted');

select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(30);
select ok((select relrowsecurity from pg_class where oid = 'public.assignments'::regclass), 'assignments RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.todos'::regclass), 'todos RLS enabled');
select ok(not has_table_privilege('anon','public.assignments','SELECT'), 'no anonymous reads');
select ok(not has_table_privilege('authenticated','public.todos','INSERT'), 'no user writes');
select ok(not has_table_privilege('service_role','public.todos','UPDATE'), 'backend uses RPC for updates');
select ok(not has_table_privilege('service_role','public.assignments','INSERT'), 'backend uses RPC for creation');
select ok(not has_function_privilege('anon','public.assignment_create(text,text,text)','EXECUTE'), 'anonymous RPC refused');
select ok(not has_function_privilege('authenticated','public.assignment_get(text,text)','EXECUTE'), 'user RPC refused');
select ok(has_function_privilege('service_role','public.assignment_get(text,text)','EXECUTE'), 'backend RPC allowed');
select ok(not has_function_privilege('service_role','public.assignment_valid_project(text)','EXECUTE'), 'helper private');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.todos'::regclass and contype='p'), 'PRIMARY KEY (assignment_id, "position")', 'composite item key');
select is((select count(*)::integer from pg_indexes where schemaname='public' and tablename='todos'), 1, 'no redundant item index');
select is((select data_type from information_schema.columns where table_schema='public' and table_name='todos' and column_name='assignment_id'), 'text', 'short assignment foreign key');
select ok(not has_function_privilege('service_role','public.assignment_notes(text,text,text)','EXECUTE'), 'notes helper private');
select ok(not has_function_privilege('service_role','public.assignment_nonblank(text)','EXECUTE'), 'nonblank helper private');
select ok(case when role_name = 'service_role' then has_function_privilege(role_name, signature, 'EXECUTE')
  else not has_function_privilege(role_name, signature, 'EXECUTE') end, role_name || ' operation privilege: ' || signature)
from unnest(array['anon','authenticated','service_role']) role_name
cross join unnest(array[
 'public.assignment_append_todos(text,text,text[])',
 'public.assignment_update_todo(text,text,integer,timestamptz,text,text,text)',
 'public.assignment_close(text,text,text)',
 'public.assignment_prepare_notes(text,text,text)',
 'public.assignment_locate_notes(text,text)']) signature;
select * from finish();
rollback;

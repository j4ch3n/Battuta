-- Test-only: run as an isolated DB admin able to SET ROLE to the existing roles.
-- No grants, role creation, RLS changes, or persisted fixture changes.
begin;
set local statement_timeout = '10s';
do $$
declare
  role_name text;
  privilege_name text;
  signature text;
  operation text;
  functions text[] := array[
    'public.delegate_task(text,text,text,text,text)', 'public.claim_task(text,text)',
    'public.complete_task(text,uuid)', 'public.fail_task(text,uuid,text)'
  ];
begin
  if not (select relrowsecurity from pg_class where oid = 'public.tasks_pool'::regclass) then
    raise exception 'tasks_pool must have RLS enabled';
  end if;
  if exists (
    select 1 from pg_class c,
      lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.tasks_pool'::regclass and a.grantee = 0
  ) then
    raise exception 'PUBLIC must have no table privileges';
  end if;
  foreach signature in array functions loop
    if not (select prosecdef from pg_proc where oid = signature::regprocedure) then
      raise exception '% must be SECURITY DEFINER', signature;
    end if;
    if exists (
      select 1 from pg_proc p,
        lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = signature::regprocedure and a.grantee = 0
    ) then
      raise exception 'PUBLIC must not execute %', signature;
    end if;
  end loop;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(role_name, 'public.tasks_pool', privilege_name)
         is distinct from (role_name = 'service_role' and privilege_name = 'SELECT') then
        raise exception 'unexpected % privilege for %', privilege_name, role_name;
      end if;
    end loop;
    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_any_column_privilege(role_name, 'public.tasks_pool', privilege_name)
         is distinct from (role_name = 'service_role' and privilege_name = 'SELECT') then
        raise exception 'unexpected column % privilege for %', privilege_name, role_name;
      end if;
    end loop;
    foreach signature in array functions loop
      if has_function_privilege(role_name, signature, 'EXECUTE')
         is distinct from (role_name = 'service_role') then
        raise exception 'unexpected EXECUTE privilege for % on %', role_name, signature;
      end if;
    end loop;

    execute format('set local role %I', role_name);
    -- Exercise denials, not merely ACL metadata. Zero-row writes avoid fixtures.
    foreach operation in array array[
      'insert into public.tasks_pool (idempotency_key, project, ticket_id, instruction) select ''unused'', ''test'', ''FIS-40'', ''test'' where false',
      'update public.tasks_pool set instruction = instruction where false',
      'delete from public.tasks_pool where false',
      'truncate public.tasks_pool'
    ] loop
      begin
        execute operation;
        raise exception 'expected insufficient_privilege for %: %', role_name, operation;
      exception when insufficient_privilege then
        null;
      end;
    end loop;
    if role_name = 'service_role' then
      perform id from public.tasks_pool limit 1;
    else
      foreach operation in array array[
        'select * from public.tasks_pool limit 0',
        'select public.delegate_task(null,null,null,null,null)',
        'select public.claim_task(null,null)',
        'select public.complete_task(null,null)',
        'select public.fail_task(null,null,null)'
      ] loop
        begin
          execute operation;
          raise exception 'expected insufficient_privilege for %: %', role_name, operation;
        exception when insufficient_privilege then
          null;
        end;
      end loop;
    end if;
    reset role;
  end loop;
end $$;
rollback;

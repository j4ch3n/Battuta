-- One pg_cron job blocks lapsed leases (and tells the Manager), then asks silent workers to report.
-- Mail it writes must match agent mail's strict content contract: only project, objective, body,
-- requirements and result keys; identifiers go in the text.
create extension if not exists pg_cron;

create function public.assignment_fill(p_template jsonb, p_row public.assignments)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_object_agg(key, left(replace(replace(replace(p_template->>key,
      '{assignment_id}', p_row.id),
      '{worker}', coalesce(p_row.claimed_by, 'unknown worker')),
      '{claimed_at}', coalesce(to_jsonb(p_row.claimed_at)#>>'{}', 'not recorded')),
    case key when 'objective' then 2000 else 4000 end))
  from unnest(array['objective', 'body']) key;
$$;

create function public.assignment_expire_leases()
returns integer language plpgsql security definer set search_path='' as $$
declare v_settings jsonb; v_row public.assignments; v_blocker jsonb; v_text text; v_notice jsonb; v_count integer := 0;
begin
  select value into v_settings from public.assignment_settings;
  if not found then return 0; end if;
  for v_row in select * from public.assignments where status = 'in_process' and lease_expired_at < now()
    order by lease_expired_at for update skip locked
  loop
    -- Each row is its own subtransaction: its block and notice commit together, and a bad row skips only itself.
    begin
      v_blocker := public.assignment_fill(v_settings->'messages'->'expiry_blocker', v_row);
      v_text := left((v_blocker->>'objective') || E'\n\n' || (v_blocker->>'body'), 4000);
      if not (public.assignment_block_owned(v_row.project, v_row.id, v_row.claimed_at, v_text)->>'ok')::boolean then
        continue;
      end if;
      v_notice := public.assignment_fill(v_settings->'messages'->'manager_expiry_notice', v_row);
      perform public.agent_mail_store(v_row.claimed_by, v_settings->'roles'->>'manager', v_row.claim_conversation_id,
        'chat', jsonb_build_object('project', v_row.project, 'objective', v_notice->>'objective',
          'body', v_notice->>'body',
          'result', jsonb_build_object('state', 'blocked', 'checks', '[]'::jsonb, 'blocker', v_text)),
        null, null, 'queue');
      v_count := v_count + 1;
    exception when others then
      raise warning 'lease expiry for assignment % failed: %', v_row.id, sqlerrm;
    end;
  end loop;
  return v_count;
end $$;

create function public.assignment_request_progress()
returns integer language plpgsql security definer set search_path='' as $$
declare v_settings jsonb; v_manager text; v_row public.assignments; v_request jsonb; v_count integer := 0;
begin
  select value into v_settings from public.assignment_settings;
  if not found then return 0; end if;
  v_manager := v_settings->'roles'->>'manager';
  for v_row in
    select a.* from public.assignments a
    where a.status = 'in_process' and a.lease_expired_at >= now()
      -- Last report: the claim, a TODO write, or mail either way between worker and Manager. A worker holds
      -- one assignment at a time, so its mail since the claim belongs to this assignment.
      and greatest(a.claimed_at,
        (select max(t.updated_at) from public.todos t where t.assignment_id = a.id),
        (select max(m.created_at) from public.agent_messages m where m.created_at >= a.claimed_at
          and ((m.sender = a.claimed_by and m.recipient = v_manager)
            or (m.sender = v_manager and m.recipient = a.claimed_by))))
        < now() - make_interval(secs => (v_settings->'progress'->>'report_after')::integer)
      -- A worker waiting on its own question is chasing the Manager already.
      and not exists (select 1 from public.agent_messages m where m.sender = a.claimed_by
        and m.recipient = v_manager and m.created_at >= a.claimed_at
        and m.content ? 'requirements' and m.status <> 'replied')
  loop
    begin
      v_request := public.assignment_fill(v_settings->'messages'->'progress_request', v_row);
      perform public.agent_mail_store(v_manager, v_row.claimed_by, v_row.claim_conversation_id, 'chat',
        jsonb_build_object('project', v_row.project, 'objective', v_request->>'objective',
          'requirements', jsonb_build_array(v_request->>'body')),
        5, null, 'steer');
      v_count := v_count + 1;
    exception when others then
      raise warning 'progress request for assignment % failed: %', v_row.id, sqlerrm;
    end;
  end loop;
  return v_count;
end $$;

create function public.assignment_lifecycle_scan()
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.assignment_settings) then return; end if;
  perform public.assignment_expire_leases();
  perform public.assignment_request_progress();
end $$;

revoke all on function public.assignment_fill(jsonb, public.assignments), public.assignment_expire_leases(),
  public.assignment_request_progress(), public.assignment_lifecycle_scan()
  from public, anon, authenticated, service_role;

-- Schedule the job for settings synced before this migration.
select public.assignment_settings_apply(value) from public.assignment_settings;

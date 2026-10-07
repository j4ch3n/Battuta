-- Task authority stays behind verified Edge principals and service-only RPCs.
-- Count compact UTF-8 JSON, not JSONB's pretty-print separator spaces. The Edge
-- uses JSON.stringify; key order does not change the byte total.
create function public.task_pool_json_bytes(p_value jsonb)
returns bigint language plpgsql stable set search_path = '' as $$
declare v_total bigint := 2; v_count bigint := 0; v_key text; v_item jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    for v_key,v_item in select key,value from jsonb_each(p_value) loop
      v_total := v_total + octet_length(to_jsonb(v_key)::text) + 1 + public.task_pool_json_bytes(v_item);
      v_count := v_count + 1;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_item in select value from jsonb_array_elements(p_value) loop
      v_total := v_total + public.task_pool_json_bytes(v_item); v_count := v_count + 1;
    end loop;
  else return octet_length(p_value::text);
  end if;
  return v_total + greatest(v_count - 1,0);
end $$;

create function public.task_pool_valid(p_value jsonb, p_kind text)
returns boolean language plpgsql stable set search_path = '' as $$
declare v_keys text[]; v_key text; v_item jsonb; v_limit integer;
begin
  if p_value is null then return false; end if;
  if p_kind in ('text','summary','locator','criterion_id','project','ticket','key','session','worker') then
    v_limit := case p_kind when 'summary' then 2000 when 'locator' then 2000 when 'criterion_id' then 64 when 'project' then 128 when 'ticket' then 64 when 'key' then 256 when 'session' then 256 else 4000 end;
    if jsonb_typeof(p_value) <> 'string' or length(p_value #>> '{}') > v_limit or (p_value #>> '{}') !~ '\S' then return false; end if;
    if p_kind in ('project','ticket') and ((p_value #>> '{}') ~ '[/\\]' or strpos(p_value #>> '{}','..') > 0 or (p_value #>> '{}') = '.' or (p_value #>> '{}') ~ '[[:cntrl:]]') then return false; end if;
    if p_kind in ('criterion_id','worker') and (p_value #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' then return false; end if;
    return true;
  end if;
  if p_kind like 'list:%' then
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 30 then return false; end if;
    for v_item in select value from jsonb_array_elements(p_value) loop
      if public.task_pool_valid(v_item, substr(p_kind,6)) is not true then return false; end if;
    end loop;
    return true;
  end if;
  v_keys := case p_kind
    when 'instruction' then array['schema_version','summary','objective','scope','constraints','inputs','acceptance_criteria','deliverables']
    when 'reference' then array['locator','description']
    when 'criterion' then array['id','expectation']
    when 'report' then array['schema_version','state','summary','checks','artifacts','failure']
    when 'check' then array['criterion_id','result','evidence']
    when 'mail_ref' then array['conversation_id','id'] else null end;
  if v_keys is null or jsonb_typeof(p_value) <> 'object' or not p_value ?& v_keys then return false; end if;
  for v_key in select jsonb_object_keys(p_value) loop
    if not v_key = any(v_keys) then return false; end if;
  end loop;
  case p_kind
    when 'instruction' then
      return public.task_pool_json_bytes(p_value) <= 65536 and p_value->'schema_version' = '1'::jsonb
        and public.task_pool_valid(p_value->'summary','summary') and public.task_pool_valid(p_value->'objective','text')
        and public.task_pool_valid(p_value->'scope','list:text') and jsonb_array_length(p_value->'scope') > 0
        and public.task_pool_valid(p_value->'constraints','list:text') and public.task_pool_valid(p_value->'inputs','list:reference')
        and public.task_pool_valid(p_value->'acceptance_criteria','list:criterion') and jsonb_array_length(p_value->'acceptance_criteria') > 0
        and (select count(*) = count(distinct value->>'id') from jsonb_array_elements(p_value->'acceptance_criteria'))
        and public.task_pool_valid(p_value->'deliverables','list:text') and jsonb_array_length(p_value->'deliverables') > 0;
    when 'reference' then return public.task_pool_valid(p_value->'locator','locator') and public.task_pool_valid(p_value->'description','text');
    when 'criterion' then return public.task_pool_valid(p_value->'id','criterion_id') and public.task_pool_valid(p_value->'expectation','text');
    when 'report' then return public.task_pool_json_bytes(p_value) <= 65536 and p_value->'schema_version' = '1'::jsonb and p_value->>'state' in ('completed','failed')
      and public.task_pool_valid(p_value->'summary','summary') and public.task_pool_valid(p_value->'checks','list:check')
      and public.task_pool_valid(p_value->'artifacts','list:reference')
      and case when p_value->>'state' = 'completed' then p_value->'failure' = 'null'::jsonb else public.task_pool_valid(p_value->'failure','text') end;
    when 'check' then return public.task_pool_valid(p_value->'criterion_id','criterion_id') and p_value->>'result' in ('passed','failed','not_verified') and public.task_pool_valid(p_value->'evidence','list:reference');
    when 'mail_ref' then return jsonb_typeof(p_value->'conversation_id') = 'string' and p_value->>'conversation_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and jsonb_typeof(p_value->'id') = 'string' and p_value->>'id' ~ '^[a-f0-9]{12}$';
    else return false;
  end case;
exception when others then return false;
end $$;

create function public.task_pool_report_valid(p_report jsonb, p_instruction jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
begin
  if public.task_pool_valid(p_report,'report') is not true then return false; end if;
  if (select count(*) <> count(distinct value->>'criterion_id') from jsonb_array_elements(p_report->'checks')) then return false; end if;
  if exists (select 1 from jsonb_array_elements(p_report->'checks') c where not exists (select 1 from jsonb_array_elements(p_instruction->'acceptance_criteria') a where a->>'id'=c->>'criterion_id')) then return false; end if;
  if p_report->>'state' = 'completed' then
    if jsonb_array_length(p_report->'checks') <> jsonb_array_length(p_instruction->'acceptance_criteria') or exists (select 1 from jsonb_array_elements(p_report->'checks') c where c->>'result' <> 'passed' or jsonb_array_length(c->'evidence')=0) then return false; end if;
  end if;
  return true;
end $$;

create table public.tasks_pool (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  project text not null,
  ticket_id text,
  delegator_role text not null check (delegator_role in ('pm','tl')),
  instruction jsonb not null,
  created_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  opencode_session_id text unique,
  terminal_report jsonb,
  finished_at timestamptz,
  result_message_ref jsonb,
  check ((claimed_by is null) = (claimed_at is null)),
  check (claimed_by is not null or (opencode_session_id is null and terminal_report is null)),
  check ((terminal_report is null) = (finished_at is null) and (terminal_report is null) = (result_message_ref is null)),
  check (terminal_report is null or (terminal_report->>'state' = 'failed' or opencode_session_id is not null))
);
create index tasks_pool_queue on public.tasks_pool(project,created_at,id) where claimed_by is null;
create index tasks_pool_owned on public.tasks_pool(claimed_by,created_at,id) where claimed_by is not null and terminal_report is null;
alter table public.tasks_pool enable row level security;
revoke all on public.tasks_pool from public, anon, authenticated;
grant select, insert, update, delete on public.tasks_pool to service_role;

create function public.task_pool_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.id,new.key,new.project,new.ticket_id,new.delegator_role,new.instruction,new.created_at) is distinct from row(old.id,old.key,old.project,old.ticket_id,old.delegator_role,old.instruction,old.created_at)
      or (old.claimed_by is not null and row(new.claimed_by,new.claimed_at) is distinct from row(old.claimed_by,old.claimed_at))
      or (old.opencode_session_id is not null and new.opencode_session_id is distinct from old.opencode_session_id)
      or (old.terminal_report is not null and new is distinct from old) then raise exception 'Task conflict' using errcode='PT409'; end if;
  end if;
  if public.task_pool_valid(to_jsonb(new.key),'key') is not true or public.task_pool_valid(to_jsonb(new.project),'project') is not true
    or (new.ticket_id is not null and public.task_pool_valid(to_jsonb(new.ticket_id),'ticket') is not true)
    or public.task_pool_valid(new.instruction,'instruction') is not true
    or (new.claimed_by is not null and new.claimed_by !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$')
    or (new.opencode_session_id is not null and public.task_pool_valid(to_jsonb(new.opencode_session_id),'session') is not true) then raise exception 'Invalid task request' using errcode='22023'; end if;
  if new.terminal_report is not null then
    if public.task_pool_report_valid(new.terminal_report,new.instruction) is not true or public.task_pool_valid(new.result_message_ref,'mail_ref') is not true then raise exception 'Invalid task report' using errcode='22023'; end if;
    if not exists (select 1 from public.agent_messages m where m.conversation_id=(new.result_message_ref->>'conversation_id')::uuid and m.id=new.result_message_ref->>'id' and m.sender='worker.'||new.claimed_by and m.recipient=new.delegator_role) then raise exception 'Invalid task result mail' using errcode='22023'; end if;
  end if;
  return new;
end $$;
create trigger tasks_pool_guard before insert or update on public.tasks_pool for each row execute function public.task_pool_guard();

create function public.task_pool_delegate(p_role text,p_key text,p_project text,p_ticket_id text,p_instruction jsonb)
returns public.tasks_pool language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks_pool;
begin
  if p_role is null or p_role not in ('pm','tl') then raise exception 'Task forbidden' using errcode='PT403'; end if;
  insert into public.tasks_pool(key,project,ticket_id,delegator_role,instruction) values(p_key,p_project,p_ticket_id,p_role,p_instruction)
    on conflict(key) do nothing returning * into v_task;
  if not found then
    select * into v_task from public.tasks_pool where key=p_key;
    if row(v_task.project,v_task.ticket_id,v_task.delegator_role,v_task.instruction) is distinct from row(p_project,p_ticket_id,p_role,p_instruction) then raise exception 'Task conflict' using errcode='PT409'; end if;
  else
    -- Wake-ups are hints only: retain a durable delegation even if Realtime is unavailable.
    begin perform realtime.send(jsonb_build_object('project',p_project),'queued','task-pool:'||p_project,true);
    exception when others then null; end;
  end if;
  return v_task;
end $$;

create function public.task_pool_claim(p_worker_id text,p_projects text[])
returns public.tasks_pool language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks_pool;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' or p_projects is null or cardinality(p_projects)=0 then raise exception 'Invalid task request' using errcode='22023'; end if;
  select * into v_task from public.tasks_pool where project=any(p_projects) and claimed_by is null order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  update public.tasks_pool set claimed_by=p_worker_id,claimed_at=now() where id=v_task.id returning * into v_task;
  return v_task;
end $$;

create function public.task_pool_list_owned(p_worker_id text,p_after_created_at timestamptz,p_after_id uuid,p_limit integer)
returns setof public.tasks_pool language plpgsql security definer set search_path = '' as $$
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' or p_limit is null or p_limit < 1 or p_limit > 101 or (p_after_created_at is null) <> (p_after_id is null) then raise exception 'Invalid task request' using errcode='22023'; end if;
  return query select * from public.tasks_pool where claimed_by=p_worker_id and terminal_report is null and (p_after_id is null or (created_at,id) > (p_after_created_at,p_after_id)) order by created_at,id limit p_limit;
end $$;

create function public.task_pool_get_owned(p_worker_id text,p_task_id uuid)
returns public.tasks_pool language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks_pool;
begin
  select * into v_task from public.tasks_pool where id=p_task_id and claimed_by=p_worker_id;
  if not found then raise exception 'Task forbidden' using errcode='PT403'; end if;
  return v_task;
end $$;

create function public.task_pool_bind(p_worker_id text,p_task_id uuid,p_session_id text)
returns public.tasks_pool language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks_pool;
begin
  select * into v_task from public.tasks_pool where id=p_task_id for update;
  if not found or v_task.claimed_by is null or v_task.claimed_by is distinct from p_worker_id then raise exception 'Task forbidden' using errcode='PT403'; end if;
  if v_task.opencode_session_id = p_session_id then return v_task; end if;
  if v_task.terminal_report is not null or v_task.opencode_session_id is not null then raise exception 'Task conflict' using errcode='PT409'; end if;
  if public.task_pool_valid(to_jsonb(p_session_id),'session') is not true then raise exception 'Invalid task request' using errcode='22023'; end if;
  update public.tasks_pool set opencode_session_id=p_session_id where id=p_task_id returning * into v_task;
  return v_task;
end $$;

create function public.task_pool_finalize(p_worker_id text,p_task_id uuid,p_report jsonb)
returns public.tasks_pool language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks_pool; v_mail public.agent_messages; v_content jsonb; v_references jsonb;
begin
  select * into v_task from public.tasks_pool where id=p_task_id for update;
  if not found or v_task.claimed_by is null or v_task.claimed_by is distinct from p_worker_id then raise exception 'Task forbidden' using errcode='PT403'; end if;
  if v_task.terminal_report is not null then
    if v_task.terminal_report = p_report then return v_task; end if;
    raise exception 'Task conflict' using errcode='PT409';
  end if;
  if public.task_pool_report_valid(p_report,v_task.instruction) is not true or (p_report->>'state'='completed' and v_task.opencode_session_id is null) then raise exception 'Invalid task report' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('locator',value->>'locator','note',value->>'description')),'[]'::jsonb) into v_references from jsonb_array_elements(p_report->'artifacts');
  v_content := jsonb_build_object('schema_version',1,'kind','worker_result','state',p_report->>'state','text',v_task.project||' — '||(v_task.instruction->>'summary')||E'\n'||(p_report->>'summary')||case when p_report->>'failure' is null then '' else E'\n'||(p_report->>'failure') end,'references',v_references);
  v_mail := public.agent_mail_store('worker.'||p_worker_id,v_task.delegator_role,gen_random_uuid(),'chat',v_content,null,null);
  update public.tasks_pool set terminal_report=p_report,finished_at=now(),result_message_ref=jsonb_build_object('conversation_id',v_mail.conversation_id,'id',v_mail.id) where id=p_task_id returning * into v_task;
  return v_task;
end $$;

-- No caller can execute helpers or impersonate a principal through RPC.
revoke all on function public.task_pool_json_bytes(jsonb), public.task_pool_valid(jsonb,text), public.task_pool_report_valid(jsonb,jsonb), public.task_pool_guard() from public,anon,authenticated,service_role;
revoke all on function public.task_pool_delegate(text,text,text,text,jsonb), public.task_pool_claim(text,text[]), public.task_pool_list_owned(text,timestamptz,uuid,integer), public.task_pool_get_owned(text,uuid), public.task_pool_bind(text,uuid,text), public.task_pool_finalize(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.task_pool_delegate(text,text,text,text,jsonb), public.task_pool_claim(text,text[]), public.task_pool_list_owned(text,timestamptz,uuid,integer), public.task_pool_get_owned(text,uuid), public.task_pool_bind(text,uuid,text), public.task_pool_finalize(text,uuid,jsonb) to service_role;

create policy task_pool_worker_receive on realtime.messages for select to authenticated using (
  extension = 'broadcast' and (select auth.jwt())->'app_metadata'->'battuta'->>'role' = 'worker'
  and jsonb_typeof((select auth.jwt())->'app_metadata'->'battuta'->'projects') = 'array'
  and (select auth.jwt())->'app_metadata'->'battuta'->'projects' ? substr((select realtime.topic()),11)
  and (select realtime.topic()) = 'task-pool:' || substr((select realtime.topic()),11)
  and (select auth.jwt())->'app_metadata'->'battuta'->>'worker_id' ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
);

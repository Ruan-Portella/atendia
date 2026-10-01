-- Boavoz · fila de entrada da Meta (L1, passo 2)
-- Idempotente.

-- Todo evento do WhatsApp e do Instagram é gravado aqui ANTES de o webhook responder 200.
-- Se a função cair no meio, o evento continua aqui e a varredura tenta de novo (até 5 vezes).
-- Chave = hash da chave do evento (o id do WhatsApp contém o telefone): wa:msg:{wamid},
-- wa:echo:{wamid}, wa:st:{wamid}:{status}, ig:msg:{mid}, ig:echo:{mid}, {campo}:sha256(evento).
-- O conteúdo vai cifrado (secret-box) e é apagado ao concluir; a linha fica 8 dias para
-- descartar os reenvios do WhatsApp (até 7 dias).
create table if not exists public.inbound_events (
  key_hash text primary key,
  source text not null,                     -- whatsapp | instagram
  kind text not null,                       -- msg | echo | status | account_update
  bot_id uuid references public.bots(id) on delete cascade,
  contact_hash text not null,               -- agrupa e trava por contato (ou o próprio evento)
  payload_enc text,
  status text not null default 'received',  -- received | processing | done | failed
  attempts int not null default 0,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists inbound_events_pending_idx on public.inbound_events (created_at) where status in ('received', 'processing');
create index if not exists inbound_events_group_idx on public.inbound_events (source, bot_id, contact_hash) where status in ('received', 'processing');
alter table public.inbound_events enable row level security; -- interna: sem policy, sem grant
grant all on public.inbound_events to service_role;

-- Mensagem do contato gravada uma vez só por evento (o reprocesso não duplica) e id da
-- mensagem no canal depois de enviada (resposta gerada e não enviada é só enviada no reprocesso).
alter table public.messages add column if not exists inbound_key text;
alter table public.messages add column if not exists channel_msg_id text;
create unique index if not exists messages_inbound_key_idx on public.messages (inbound_key) where inbound_key is not null;

-- Entrada: grava o evento; false se já existia (reenvio da Meta ou eco de mensagem nossa).
create or replace function public.inbound_accept(p_key_hash text, p_source text, p_kind text, p_bot_id uuid, p_contact_hash text, p_payload_enc text, p_done boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare inserted int;
begin
  insert into public.inbound_events (key_hash, source, kind, bot_id, contact_hash, payload_enc, status, done_at)
  values (p_key_hash, p_source, p_kind, p_bot_id, p_contact_hash, case when p_done then null else p_payload_enc end,
          case when p_done then 'done' else 'received' end, case when p_done then now() end)
  on conflict (key_hash) do nothing;
  get diagnostics inserted = row_count;
  return inserted > 0;
end;
$$;

-- Pega os eventos pendentes de um contato, em ordem, se ninguém estiver com ele agora.
-- A trava (p_lease segundos) fica acima do maxDuration da função: quem muda um muda o outro.
create or replace function public.inbound_claim(p_source text, p_bot_id uuid, p_contact_hash text, p_lease int default 90)
returns setof public.inbound_events language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_source || ':' || coalesce(p_bot_id::text, '-') || ':' || p_contact_hash));
  if exists (
    select 1 from public.inbound_events
    where source = p_source and bot_id is not distinct from p_bot_id and contact_hash = p_contact_hash
      and status = 'processing' and locked_until > now()
  ) then
    return;
  end if;
  return query
    update public.inbound_events e set status = 'processing', locked_until = now() + make_interval(secs => p_lease), attempts = e.attempts + 1
    where e.key_hash in (
      select key_hash from public.inbound_events
      where source = p_source and bot_id is not distinct from p_bot_id and contact_hash = p_contact_hash
        and status in ('received', 'processing') and (locked_until is null or locked_until <= now()) and attempts < 5
      order by created_at
      for update skip locked
    )
    returning e.*;
end;
$$;

-- Saída: sem erro, conclui e apaga o conteúdo; com erro, volta para a fila (ou "failed" na 5ª).
create or replace function public.inbound_finish(p_keys text[], p_error text default null)
returns int language plpgsql security definer set search_path = public as $$
declare failed int;
begin
  if p_error is null then
    update public.inbound_events set status = 'done', payload_enc = null, locked_until = null, done_at = now(), last_error = null
    where key_hash = any(p_keys);
    return 0;
  end if;
  update public.inbound_events
  set status = case when attempts >= 5 then 'failed' else 'received' end,
      payload_enc = case when attempts >= 5 then null else payload_enc end,
      locked_until = null, last_error = left(p_error, 500)
  where key_hash = any(p_keys);
  select count(*) into failed from public.inbound_events where key_hash = any(p_keys) and status = 'failed';
  return failed;
end;
$$;

-- Varredura: grupos com evento pendente há mais de p_min_age segundos ou com a trava vencida.
create or replace function public.inbound_due(p_min_age int default 30, p_limit int default 20)
returns table (source text, bot_id uuid, contact_hash text) language sql stable security definer set search_path = public as $$
  select source, bot_id, contact_hash from public.inbound_events
  where attempts < 5 and (
    (status = 'received' and created_at < now() - make_interval(secs => p_min_age))
    or (status = 'processing' and locked_until <= now())
  )
  group by source, bot_id, contact_hash
  order by min(created_at)
  limit p_limit;
$$;

-- Idade (segundos) do evento pendente mais antigo, para o /api/health.
create or replace function public.inbound_oldest_pending_seconds()
returns int language sql stable security definer set search_path = public as $$
  select coalesce(extract(epoch from now() - min(created_at))::int, 0)
  from public.inbound_events where status in ('received', 'processing');
$$;

revoke all on function public.inbound_accept(text, text, text, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.inbound_claim(text, uuid, text, int) from public, anon, authenticated;
revoke all on function public.inbound_finish(text[], text) from public, anon, authenticated;
revoke all on function public.inbound_due(int, int) from public, anon, authenticated;
revoke all on function public.inbound_oldest_pending_seconds() from public, anon, authenticated;

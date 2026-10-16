-- Boavoz · cota por chatbot (revisão de preços, parte 3; 16/10/2026).
-- Cada chatbot tem um tamanho (P, M, G ou Volume) com a própria cota do mês. 1 atendimento =
-- até 24 horas desde a primeira resposta da IA, com até 40 respostas: a 41ª abre outro. Sem
-- tolerância: cota cheia, só aquele chatbot entra no modo só humano. Sem clientes na produção,
-- a cota da agência (quota_override) e o limite por cliente (monthly_quota_cap) saem direto.
-- Idempotente.

-- tamanho do chatbot; sem tamanho (nulo), o chatbot não tem cota. Até a cobrança por tamanho
-- (parte 4), todo chatbot nasce P.
alter table public.bots add column if not exists size text default 'P';
alter table public.bots drop constraint if exists bots_size_check;
alter table public.bots add constraint bots_size_check check (size is null or size in ('P', 'M', 'G', 'volume'));
-- pacotes de 1.000 atendimentos do tamanho Volume
alter table public.bots add column if not exists volume_packs int;
alter table public.bots drop constraint if exists bots_volume_packs_check;
alter table public.bots add constraint bots_volume_packs_check check ((volume_packs is null or volume_packs >= 1) and (size is distinct from 'volume' or volume_packs is not null));
-- cota combinada fora da tabela (plano sob medida), no lugar da do tamanho. Só o servidor grava.
alter table public.bots add column if not exists quota_override int check (quota_override is null or quota_override >= 0);

-- A agência atualiza os próprios chatbots pela sessão (política bots_owner), então o tamanho e a
-- cota ficam presos a quem não é a sessão: só o servidor (service role) e as migrações mudam.
-- Chatbot criado pela sessão nasce P, sem pacotes nem cota combinada.
create or replace function public.guard_bot_quota() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.size := 'P';
      new.volume_packs := null;
      new.quota_override := null;
    elsif new.size is distinct from old.size or new.volume_packs is distinct from old.volume_packs or new.quota_override is distinct from old.quota_override then
      raise exception 'o tamanho e a cota do chatbot só mudam pelo servidor' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists bots_guard_quota on public.bots;
create trigger bots_guard_quota before insert or update on public.bots for each row execute function public.guard_bot_quota();

-- respostas da IA neste atendimento (o limite de 40 abre outro)
alter table public.atendimentos add column if not exists answers int not null default 1;
create index if not exists atendimentos_bot_month_idx on public.atendimentos (bot_id, started_at);

alter table public.agencies drop column if exists quota_override;
alter table public.clients drop column if exists monthly_quota_cap;
drop function if exists public.client_month_atendimentos(uuid, timestamptz);

/*
 * Chamada antes de cada resposta da IA (service role), sob a trava do contato. Atendimento aberto
 * há menos de 24 horas e com menos respostas que o limite: soma uma resposta e segue. Senão (sem
 * atendimento aberto, ou o aberto chegou ao limite), confere a cota do mês do chatbot e abre outro
 * ou devolve 'cota'. Atendimento no limite com a cota cheia também devolve 'cota': termina ali.
 * p_size_quotas: a cota de cada tamanho, de src/lib/plans.ts (Volume: por pacote).
 */
drop function if exists public.open_atendimento(uuid, text, text, uuid, jsonb, numeric);
create or replace function public.open_atendimento(
  p_bot_id uuid,
  p_channel text,
  p_contact_key_hash text,
  p_conversation_id uuid,
  p_size_quotas jsonb,
  p_answer_limit int default 40
)
returns table (status text, atendimento_id bigint, used int, quota int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_client uuid;
  v_size text;
  v_packs int;
  v_override int;
  v_id bigint;
  v_answers int;
  v_quota int;
  v_used int;
  v_start timestamptz;
begin
  select b.agency_id, b.client_id, b.size, b.volume_packs, b.quota_override into v_agency, v_client, v_size, v_packs, v_override
  from public.bots b where b.id = p_bot_id;
  if v_agency is null then
    raise exception 'chatbot não encontrado';
  end if;

  -- trava do contato: duas mensagens juntas do mesmo contato não abrem dois atendimentos
  perform pg_advisory_xact_lock(hashtextextended('atendimento:' || p_bot_id || ':' || p_channel || ':' || p_contact_key_hash, 0));
  select a.id, a.answers into v_id, v_answers from public.atendimentos a
  where a.bot_id = p_bot_id and a.channel = p_channel and a.contact_key_hash = p_contact_key_hash
    and a.started_at > now() - interval '24 hours'
  order by a.started_at desc
  limit 1;
  if v_id is not null and v_answers < p_answer_limit then
    update public.atendimentos set answers = answers + 1 where id = v_id;
    return query select 'aberto'::text, v_id, null::int, null::int;
    return;
  end if;

  -- trava do chatbot: a contagem do mês e a inserção não se cruzam com outra abertura
  perform pg_advisory_xact_lock(hashtextextended('atendimentos-bot:' || p_bot_id, 0));
  v_quota := coalesce(
    v_override,
    case when v_size = 'volume' then coalesce(v_packs, 0) * coalesce((p_size_quotas ->> 'volume')::int, 0) else (p_size_quotas ->> v_size)::int end,
    0
  );
  -- mês civil de São Paulo
  v_start := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select count(*) into v_used from public.atendimentos a where a.bot_id = p_bot_id and a.started_at >= v_start;
  if v_used >= v_quota then
    return query select 'cota'::text, null::bigint, v_used, v_quota;
    return;
  end if;

  insert into public.atendimentos (agency_id, client_id, bot_id, channel, contact_key_hash, first_conversation_id, answers)
  values (v_agency, v_client, p_bot_id, p_channel, p_contact_key_hash, p_conversation_id, 1)
  returning id into v_id;
  return query select 'novo'::text, v_id, v_used + 1, v_quota;
end;
$$;
revoke all on function public.open_atendimento(uuid, text, text, uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.open_atendimento(uuid, text, text, uuid, jsonb, int) to service_role;

-- Atendimentos do mês por chatbot (a mesma contagem que a abertura confere). Service role.
create or replace function public.bot_month_atendimentos(p_agency_id uuid, p_month_start timestamptz)
returns table (bot_id uuid, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select a.bot_id, count(*) from public.atendimentos a
  where a.agency_id = p_agency_id and a.started_at >= p_month_start and a.bot_id is not null
  group by a.bot_id;
$$;
revoke all on function public.bot_month_atendimentos(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.bot_month_atendimentos(uuid, timestamptz) to service_role;

notify pgrst, 'reload schema';

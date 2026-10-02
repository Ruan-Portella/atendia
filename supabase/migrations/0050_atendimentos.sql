-- Boavoz · cota por atendimento (L1). 1 atendimento = cada período de 24 horas em que a IA
-- respondeu a um contato, contado a partir da primeira resposta da IA, por contato, bot e canal.
-- Conversa nova dentro das 24 horas não abre outro; respostas da equipe, textos fixos e períodos
-- com a IA ou o bot pausados não contam (a abertura só acontece antes de chamar a IA).
-- Substitui o contador de conversas (usage.conversations e increment_usage, que saem num deploy
-- posterior). Ver src/lib/atendimentos.ts. Idempotente.

create table if not exists public.atendimentos (
  id bigserial primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- cliente e bot excluídos não devolvem a cota do mês: a linha fica, sem o vínculo
  client_id uuid references public.clients(id) on delete set null,
  bot_id uuid references public.bots(id) on delete set null,
  channel text not null check (channel in ('widget', 'whatsapp', 'instagram')),
  -- HMAC da chave do contato (ficha do contato no WhatsApp e no Instagram, visitor_id no widget)
  contact_key_hash text not null,
  first_conversation_id uuid references public.conversations(id) on delete set null,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists atendimentos_contact_idx on public.atendimentos (bot_id, channel, contact_key_hash, started_at desc);
create index if not exists atendimentos_agency_idx on public.atendimentos (agency_id, started_at);
create index if not exists atendimentos_client_idx on public.atendimentos (client_id, started_at);
create index if not exists atendimentos_conversation_idx on public.atendimentos (first_conversation_id);

alter table public.atendimentos enable row level security;
drop policy if exists atendimentos_agency_read on public.atendimentos;
create policy atendimentos_agency_read on public.atendimentos for select to authenticated
  using (agency_id = (select public.my_agency_id()));
revoke all on public.atendimentos from anon, authenticated;
grant select on public.atendimentos to authenticated;

-- Cota combinada fora do plano (assinantes de antes da cota nova; preenchida por SQL): o código
-- usa quota_override ?? a cota do plano. Só o servidor grava (ver 0040: sem grant à sessão).
alter table public.agencies add column if not exists quota_override int check (quota_override is null or quota_override >= 0);

-- Sublimite do cliente, definido pela agência em Cobrança → Uso e custo (nulo = sem sublimite)
alter table public.clients add column if not exists monthly_quota_cap int check (monthly_quota_cap is null or monthly_quota_cap >= 0);

/*
 * Chamada antes de cada chamada da IA (service role). Usa o atendimento deste contato aberto há
 * menos de 24 horas (vai até o fim, mesmo que a cota encha no meio); senão confere a cota da
 * agência (com a tolerância do mês) e o sublimite do cliente, e abre um novo ou devolve o motivo.
 * status: 'aberto' (já havia), 'novo', 'cota' (agência sem vaga), 'sublimite' (cliente sem vaga).
 * p_plan_quotas: a cota de cada plano, de src/lib/plans.ts (o banco não guarda os planos).
 */
create or replace function public.open_atendimento(
  p_bot_id uuid,
  p_channel text,
  p_contact_key_hash text,
  p_conversation_id uuid,
  p_plan_quotas jsonb,
  p_tolerance numeric default 0.1
)
returns table (status text, atendimento_id bigint, used int, quota int, client_used int, client_cap int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_client uuid;
  v_id bigint;
  v_quota int;
  v_used int;
  v_cap int;
  v_client_used int;
  v_start timestamptz;
begin
  select b.agency_id, b.client_id into v_agency, v_client from public.bots b where b.id = p_bot_id;
  if v_agency is null then
    raise exception 'chatbot não encontrado';
  end if;

  -- trava do contato: duas mensagens juntas do mesmo contato não abrem dois atendimentos
  perform pg_advisory_xact_lock(hashtextextended('atendimento:' || p_bot_id || ':' || p_channel || ':' || p_contact_key_hash, 0));
  select a.id into v_id from public.atendimentos a
  where a.bot_id = p_bot_id and a.channel = p_channel and a.contact_key_hash = p_contact_key_hash
    and a.started_at > now() - interval '24 hours'
  order by a.started_at desc
  limit 1;
  if v_id is not null then
    return query select 'aberto'::text, v_id, null::int, null::int, null::int, null::int;
    return;
  end if;

  -- trava da agência: a contagem do mês e a inserção não se cruzam com outra abertura
  perform pg_advisory_xact_lock(hashtextextended('atendimentos:' || v_agency, 0));
  select coalesce(a.quota_override, (p_plan_quotas ->> a.plan)::int, 0) into v_quota from public.agencies a where a.id = v_agency;
  -- mês civil de São Paulo
  v_start := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select count(*) into v_used from public.atendimentos a where a.agency_id = v_agency and a.started_at >= v_start;
  if v_used >= v_quota + floor(v_quota * p_tolerance) then
    return query select 'cota'::text, null::bigint, v_used, v_quota, null::int, null::int;
    return;
  end if;

  if v_client is not null then
    select c.monthly_quota_cap into v_cap from public.clients c where c.id = v_client;
    if v_cap is not null then
      select count(*) into v_client_used from public.atendimentos a where a.client_id = v_client and a.started_at >= v_start;
      if v_client_used >= v_cap then
        return query select 'sublimite'::text, null::bigint, v_used, v_quota, v_client_used, v_cap;
        return;
      end if;
    end if;
  end if;

  insert into public.atendimentos (agency_id, client_id, bot_id, channel, contact_key_hash, first_conversation_id)
  values (v_agency, v_client, p_bot_id, p_channel, p_contact_key_hash, p_conversation_id)
  returning id into v_id;
  return query select 'novo'::text, v_id, v_used + 1, v_quota, case when v_cap is null then null else v_client_used + 1 end, v_cap;
end;
$$;
revoke all on function public.open_atendimento(uuid, text, text, uuid, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.open_atendimento(uuid, text, text, uuid, jsonb, numeric) to service_role;

/*
 * Uso do mês por chatbot, para Cobrança → Uso e custo: atendimentos, mensagens (as barradas pela
 * regra de estado não contam) e mensagens do WhatsApp cobradas pela Meta, por categoria.
 * Service role: a página já conferiu que a agência é de quem pediu.
 */
create or replace function public.agency_month_usage(p_agency_id uuid, p_month_start timestamptz, p_period text)
returns table (bot_id uuid, client_id uuid, atendimentos bigint, messages bigint, meta_billed jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with a as (
    select x.bot_id, count(*) as n from public.atendimentos x
    where x.agency_id = p_agency_id and x.started_at >= p_month_start
    group by x.bot_id
  ), m as (
    select c.bot_id, count(*) as n
    from public.messages msg
    join public.conversations c on c.id = msg.conversation_id
    join public.bots b on b.id = c.bot_id
    where b.agency_id = p_agency_id and msg.created_at >= p_month_start and msg.blocked_reason is null
    group by c.bot_id
  ), w as (
    select u.bot_id, jsonb_object_agg(u.category, u.billed) as billed
    from (
      select wu.bot_id, wu.category, count(*) filter (where wu.billable) as billed
      from public.whatsapp_usage wu
      join public.bots b on b.id = wu.bot_id
      where b.agency_id = p_agency_id and wu.period = p_period
      group by wu.bot_id, wu.category
    ) u
    group by u.bot_id
  )
  select b.id, b.client_id, coalesce(a.n, 0), coalesce(m.n, 0), coalesce(w.billed, '{}'::jsonb)
  from public.bots b
  left join a on a.bot_id = b.id
  left join m on m.bot_id = b.id
  left join w on w.bot_id = b.id
  where b.agency_id = p_agency_id and not b.is_demo;
$$;
revoke all on function public.agency_month_usage(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.agency_month_usage(uuid, timestamptz, text) to service_role;

-- Atendimentos do mês por cliente (o cliente gravado na abertura, o mesmo que o sublimite confere)
create or replace function public.client_month_atendimentos(p_agency_id uuid, p_month_start timestamptz)
returns table (client_id uuid, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select a.client_id, count(*) from public.atendimentos a
  where a.agency_id = p_agency_id and a.started_at >= p_month_start and a.client_id is not null
  group by a.client_id;
$$;
revoke all on function public.client_month_atendimentos(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.client_month_atendimentos(uuid, timestamptz) to service_role;

-- Atendimentos por mês (São Paulo) de uma agência, do mais recente: backoffice
create or replace function public.atendimentos_by_month(p_agency_id uuid, p_months int default 6)
returns table (period text, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select to_char(a.started_at at time zone 'America/Sao_Paulo', 'YYYY-MM') as period, count(*) as total
  from public.atendimentos a
  where a.agency_id = p_agency_id
    and a.started_at >= (date_trunc('month', now() at time zone 'America/Sao_Paulo') - make_interval(months => greatest(p_months, 1) - 1)) at time zone 'America/Sao_Paulo'
  group by 1
  order by 1 desc;
$$;
revoke all on function public.atendimentos_by_month(uuid, int) from public, anon, authenticated;
grant execute on function public.atendimentos_by_month(uuid, int) to service_role;

-- Backoffice: a coluna do mês passa a ser atendimentos (o tipo de retorno muda: drop antes)
drop function if exists public.admin_agency_stats(text, timestamptz);
create function public.admin_agency_stats(p_period text, p_month_start timestamptz)
returns table (agency_id uuid, bots bigint, live_bots bigint, whatsapp bigint, instagram bigint, atendimentos_month bigint, ai_cost_month numeric, last_activity timestamptz)
language sql stable
set search_path = public
as $$
  select a.id,
    (select count(*) from public.bots b where b.agency_id = a.id and not b.is_demo),
    (select count(*) from public.bots b where b.agency_id = a.id and not b.is_demo and b.status = 'live'),
    (select count(*) from public.whatsapp_channels w join public.bots b on b.id = w.bot_id where b.agency_id = a.id and w.disconnected_at is null),
    (select count(*) from public.instagram_channels i join public.bots b on b.id = i.bot_id where b.agency_id = a.id and i.disconnected_at is null),
    (select count(*) from public.atendimentos x where x.agency_id = a.id and x.started_at >= p_month_start),
    coalesce((select sum(x.cost_usd) from public.ai_usage x where x.agency_id = a.id and x.created_at >= p_month_start and x.kind <> 'avaliacao'), 0),
    (select max(c.last_message_at) from public.conversations c join public.bots b on b.id = c.bot_id where b.agency_id = a.id)
  from public.agencies a
  where a.owner_id is not null;
$$;
revoke all on function public.admin_agency_stats(text, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_agency_stats(text, timestamptz) to service_role;

notify pgrst, 'reload schema';

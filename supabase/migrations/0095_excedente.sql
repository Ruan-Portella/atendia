-- Boavoz · excedente por chatbot (revisão de preços, parte 3b; 16/10/2026).
-- Opção de cada chatbot, desligada por padrão: passou da cota, cada atendimento a mais é cobrado
-- (preço em src/lib/plans.ts) até o teto de gasto do mês que a agência escolhe; no teto, o
-- chatbot entra no modo só humano. Substitui o "subir sozinho". Idempotente.

alter table public.bots add column if not exists overage_enabled boolean not null default false;
alter table public.bots add column if not exists overage_cap_brl numeric(10, 2);
alter table public.bots drop constraint if exists bots_overage_cap_check;
alter table public.bots add constraint bots_overage_cap_check check ((overage_cap_brl is null or overage_cap_brl > 0) and (not overage_enabled or overage_cap_brl is not null));

-- atendimento aberto além da cota (o excedente cobrado no fim do mês)
alter table public.atendimentos add column if not exists overage boolean not null default false;

-- o excedente gera cobrança: só o servidor (service role) e as migrações mudam, como o tamanho
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
      new.overage_enabled := false;
      new.overage_cap_brl := null;
    elsif new.size is distinct from old.size or new.volume_packs is distinct from old.volume_packs or new.quota_override is distinct from old.quota_override
      or new.overage_enabled is distinct from old.overage_enabled or new.overage_cap_brl is distinct from old.overage_cap_brl then
      raise exception 'o tamanho, a cota e o excedente do chatbot só mudam pelo servidor' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

/*
 * Como a 0094, mais o excedente: sem vaga na cota, com o excedente ligado e o teto ainda não
 * atingido, abre o atendimento marcado como excedente ('excedente'); no teto, 'teto'. Sem
 * excedente, 'cota'. Chatbot sem cota (sem tamanho) não usa excedente.
 * p_overage_price: preço de cada atendimento a mais, em reais (o teto ÷ preço = quantos cabem).
 */
drop function if exists public.open_atendimento(uuid, text, text, uuid, jsonb, int);
create or replace function public.open_atendimento(
  p_bot_id uuid,
  p_channel text,
  p_contact_key_hash text,
  p_conversation_id uuid,
  p_size_quotas jsonb,
  p_answer_limit int,
  p_overage_price numeric
)
returns table (status text, atendimento_id bigint, used int, quota int, overage_on boolean, overage_used int, overage_max int)
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
  v_overage_on boolean;
  v_cap numeric;
  v_id bigint;
  v_answers int;
  v_quota int;
  v_used int;
  v_extra int;
  v_max int;
  v_start timestamptz;
begin
  select b.agency_id, b.client_id, b.size, b.volume_packs, b.quota_override, b.overage_enabled, b.overage_cap_brl
  into v_agency, v_client, v_size, v_packs, v_override, v_overage_on, v_cap
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
    return query select 'aberto'::text, v_id, null::int, null::int, null::boolean, null::int, null::int;
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
  select count(*), count(*) filter (where a.overage) into v_used, v_extra from public.atendimentos a where a.bot_id = p_bot_id and a.started_at >= v_start;

  if v_used - v_extra < v_quota then
    insert into public.atendimentos (agency_id, client_id, bot_id, channel, contact_key_hash, first_conversation_id, answers)
    values (v_agency, v_client, p_bot_id, p_channel, p_contact_key_hash, p_conversation_id, 1)
    returning id into v_id;
    return query select 'novo'::text, v_id, v_used - v_extra + 1, v_quota, v_overage_on, v_extra, null::int;
    return;
  end if;

  if not v_overage_on or v_quota <= 0 or v_cap is null or p_overage_price is null or p_overage_price <= 0 then
    return query select 'cota'::text, null::bigint, v_used - v_extra, v_quota, v_overage_on, v_extra, null::int;
    return;
  end if;
  v_max := floor(v_cap / p_overage_price)::int;
  if v_extra >= v_max then
    return query select 'teto'::text, null::bigint, v_used - v_extra, v_quota, true, v_extra, v_max;
    return;
  end if;
  insert into public.atendimentos (agency_id, client_id, bot_id, channel, contact_key_hash, first_conversation_id, answers, overage)
  values (v_agency, v_client, p_bot_id, p_channel, p_contact_key_hash, p_conversation_id, 1, true)
  returning id into v_id;
  return query select 'excedente'::text, v_id, v_used - v_extra, v_quota, true, v_extra + 1, v_max;
end;
$$;
revoke all on function public.open_atendimento(uuid, text, text, uuid, jsonb, int, numeric) from public, anon, authenticated;
grant execute on function public.open_atendimento(uuid, text, text, uuid, jsonb, int, numeric) to service_role;

-- Atendimentos de um mês por chatbot, com os do excedente à parte (sem fim = até agora; com fim,
-- um mês fechado, para a sugestão de tamanho). Service role.
drop function if exists public.bot_month_atendimentos(uuid, timestamptz);
create or replace function public.bot_month_atendimentos(p_agency_id uuid, p_month_start timestamptz, p_month_end timestamptz default null)
returns table (bot_id uuid, total bigint, overage bigint)
language sql
stable
security definer
set search_path = public
as $$
  select a.bot_id, count(*), count(*) filter (where a.overage) from public.atendimentos a
  where a.agency_id = p_agency_id and a.started_at >= p_month_start and (p_month_end is null or a.started_at < p_month_end) and a.bot_id is not null
  group by a.bot_id;
$$;
revoke all on function public.bot_month_atendimentos(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.bot_month_atendimentos(uuid, timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';

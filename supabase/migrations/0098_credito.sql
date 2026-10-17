-- Boavoz · excedente com crédito pré-pago (revisão de preços, parte 4c; 16/10/2026).
-- O excedente deixa de ser cobrado no fim do mês (risco de calote): cada atendimento a mais
-- desconta o preço do crédito da conta, comprado antes (lotes válidos por 12 meses, o que vence
-- antes sai primeiro). Sem crédito, o chatbot entra no modo só humano. O teto do mês por chatbot
-- vira opcional. Pico de conversas novas no widget suspende o excedente do chatbot até o dono
-- confirmar. Pagamento atrasado não suspende mais o excedente (o crédito já está pago). Idempotente.

-- lotes de crédito: compra, recarga automática ou ajuste da BoaVoz
create table if not exists public.credit_lots (
  id bigserial primary key,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  remaining_cents int not null check (remaining_cents >= 0),
  source text not null check (source in ('compra', 'recarga', 'ajuste')),
  billing_change_id uuid references public.billing_changes (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists credit_lots_open_idx on public.credit_lots (agency_id, expires_at) where remaining_cents > 0;
create unique index if not exists credit_lots_change_idx on public.credit_lots (billing_change_id) where billing_change_id is not null;
alter table public.credit_lots enable row level security;
drop policy if exists credit_lots_read on public.credit_lots;
create policy credit_lots_read on public.credit_lots for select to authenticated using (agency_id = public.my_agency_id());

-- quanto cada atendimento a mais tirou do crédito (uso do mês e fechamento)
alter table public.atendimentos add column if not exists credit_cents int;

-- recarga automática: abaixo de credit_auto_below_cents, compra credit_auto_amount_cents, até
-- credit_auto_month_limit_cents no mês; credit_auto_started_at trava duas recargas juntas
alter table public.agencies add column if not exists credit_auto_enabled boolean not null default false;
alter table public.agencies add column if not exists credit_auto_below_cents int;
alter table public.agencies add column if not exists credit_auto_amount_cents int;
alter table public.agencies add column if not exists credit_auto_month_limit_cents int;
alter table public.agencies add column if not exists credit_auto_started_at timestamptz;
alter table public.agencies drop constraint if exists agencies_credit_auto_check;
alter table public.agencies add constraint agencies_credit_auto_check check (
  not credit_auto_enabled
  or (credit_auto_below_cents >= 0 and credit_auto_amount_cents >= 5000 and credit_auto_month_limit_cents >= credit_auto_amount_cents)
);

-- o teto do mês por chatbot fica opcional (o crédito já limita)
alter table public.bots drop constraint if exists bots_overage_cap_check;
alter table public.bots add constraint bots_overage_cap_check check (overage_cap_brl is null or overage_cap_brl > 0);

-- suspensão do excedente: 'pico' (até o dono confirmar) ou 'ataque' (até overage_suspended_until,
-- o dia 1º seguinte); overage_spike_ok_until: "tráfego real" confirmado, sem nova suspensão até lá
alter table public.bots add column if not exists overage_suspended_at timestamptz;
alter table public.bots add column if not exists overage_suspended_reason text;
alter table public.bots add column if not exists overage_suspended_until timestamptz;
alter table public.bots add column if not exists overage_spike_ok_until timestamptz;
alter table public.bots drop constraint if exists bots_overage_suspended_check;
alter table public.bots add constraint bots_overage_suspended_check check (
  (overage_suspended_reason is null or overage_suspended_reason in ('pico', 'ataque'))
  and ((overage_suspended_at is null) = (overage_suspended_reason is null))
);

alter table public.billing_changes drop constraint if exists billing_changes_kind_check;
alter table public.billing_changes add constraint billing_changes_kind_check check (kind in ('checkout', 'upgrade', 'credit', 'recarga'));

-- a suspensão também só muda pelo servidor
create or replace function public.guard_bot_quota() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.size := null;
      new.volume_packs := null;
      new.quota_override := null;
      new.overage_enabled := false;
      new.overage_cap_brl := null;
      new.pending_size := null;
      new.pending_volume_packs := null;
      new.pending_from := null;
      new.prorated_month := null;
      new.prorated_quota := null;
      new.overage_suspended_at := null;
      new.overage_suspended_reason := null;
      new.overage_suspended_until := null;
      new.overage_spike_ok_until := null;
    elsif new.size is distinct from old.size or new.volume_packs is distinct from old.volume_packs or new.quota_override is distinct from old.quota_override
      or new.overage_enabled is distinct from old.overage_enabled or new.overage_cap_brl is distinct from old.overage_cap_brl
      or new.pending_size is distinct from old.pending_size or new.pending_volume_packs is distinct from old.pending_volume_packs or new.pending_from is distinct from old.pending_from
      or new.prorated_month is distinct from old.prorated_month or new.prorated_quota is distinct from old.prorated_quota
      or new.overage_suspended_at is distinct from old.overage_suspended_at or new.overage_suspended_reason is distinct from old.overage_suspended_reason
      or new.overage_suspended_until is distinct from old.overage_suspended_until or new.overage_spike_ok_until is distinct from old.overage_spike_ok_until then
      raise exception 'o tamanho, a cota e o excedente do chatbot só mudam pelo servidor' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- saldo da conta: o que sobra dos lotes ainda válidos
create or replace function public.credit_balance(p_agency_id uuid) returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(remaining_cents), 0)::int from public.credit_lots where agency_id = p_agency_id and remaining_cents > 0 and expires_at > now();
$$;
revoke all on function public.credit_balance(uuid) from public, anon, authenticated;
grant execute on function public.credit_balance(uuid) to service_role;

/*
 * Põe o crédito de uma compra paga, uma vez só (a compra passa de pending para applied). Vale
 * 12 meses. p_source: 'compra' (pelo painel ou pela API), 'recarga' (automática). Devolve o saldo
 * novo, ou null se a compra já tinha entrado.
 */
create or replace function public.add_credit(p_change_id uuid, p_source text) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_amount int;
begin
  update public.billing_changes set status = 'applied', applied_at = now()
  where id = p_change_id and status = 'pending' and kind in ('credit', 'recarga')
  returning agency_id, amount_cents into v_agency, v_amount;
  if v_agency is null then
    return null;
  end if;
  insert into public.credit_lots (agency_id, amount_cents, remaining_cents, source, billing_change_id, expires_at)
  values (v_agency, v_amount, v_amount, p_source, p_change_id, now() + interval '12 months');
  return public.credit_balance(v_agency);
end;
$$;
revoke all on function public.add_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.add_credit(uuid, text) to service_role;

-- recarga automática: só uma por vez (a trava vence em 10 minutos, se o servidor cair no meio)
create or replace function public.claim_credit_recharge(p_agency_id uuid) returns boolean
language sql
security definer
set search_path = public
as $$
  with c as (
    update public.agencies set credit_auto_started_at = now()
    where id = p_agency_id and (credit_auto_started_at is null or credit_auto_started_at < now() - interval '10 minutes')
    returning 1
  )
  select exists (select 1 from c);
$$;
revoke all on function public.claim_credit_recharge(uuid) from public, anon, authenticated;
grant execute on function public.claim_credit_recharge(uuid) to service_role;

/*
 * Como a 0096, mais o crédito: sem vaga na cota, com o excedente ligado, confere a suspensão
 * ('suspenso'; 'pico' quando acabou de suspender), o teto opcional do chatbot ('teto') e o saldo
 * da conta ('sem_credito'); com saldo, desconta o preço dos lotes que vencem antes e abre o
 * atendimento a mais ('excedente'). credit_left: o saldo depois do desconto (ou o que havia).
 * Pico (widget): conversas novas do chatbot nas últimas 24 horas acima de 5 vezes a média diária
 * dos 7 dias anteriores, com mínimo de 100.
 */
drop function if exists public.open_atendimento(uuid, text, text, uuid, jsonb, int, numeric);
create or replace function public.open_atendimento(
  p_bot_id uuid,
  p_channel text,
  p_contact_key_hash text,
  p_conversation_id uuid,
  p_size_quotas jsonb,
  p_answer_limit int,
  p_overage_price numeric
)
returns table (status text, atendimento_id bigint, used int, quota int, overage_on boolean, overage_used int, overage_max int, credit_left int)
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
  v_pending_from timestamptz;
  v_prorated_month date;
  v_prorated_quota int;
  v_suspended_reason text;
  v_suspended_until timestamptz;
  v_spike_ok_until timestamptz;
  v_id bigint;
  v_answers int;
  v_quota int;
  v_used int;
  v_extra int;
  v_max int;
  v_start timestamptz;
  v_price int;
  v_balance int;
  v_need int;
  v_take int;
  v_lot record;
  v_last24 int;
  v_before7 int;
begin
  select b.agency_id, b.pending_from into v_agency, v_pending_from from public.bots b where b.id = p_bot_id;
  if v_agency is null then
    raise exception 'chatbot não encontrado';
  end if;
  -- o dia 1º chegou: a troca agendada vale agora (e a cota proporcional do tamanho antigo sai)
  if v_pending_from is not null and v_pending_from <= now() then
    update public.bots set
      size = case when pending_size = 'none' then null else pending_size end,
      volume_packs = case when pending_size = 'volume' then pending_volume_packs else null end,
      pending_size = null, pending_volume_packs = null, pending_from = null,
      prorated_month = null, prorated_quota = null
    where id = p_bot_id;
  end if;
  -- "ataque": a suspensão termina no dia 1º
  update public.bots set overage_suspended_at = null, overage_suspended_reason = null, overage_suspended_until = null
  where id = p_bot_id and overage_suspended_reason = 'ataque' and overage_suspended_until <= now();
  select b.client_id, b.size, b.volume_packs, b.quota_override, b.overage_enabled, b.overage_cap_brl, b.prorated_month, b.prorated_quota,
    b.overage_suspended_reason, b.overage_suspended_until, b.overage_spike_ok_until
  into v_client, v_size, v_packs, v_override, v_overage_on, v_cap, v_prorated_month, v_prorated_quota,
    v_suspended_reason, v_suspended_until, v_spike_ok_until
  from public.bots b where b.id = p_bot_id;

  -- trava do contato: duas mensagens juntas do mesmo contato não abrem dois atendimentos
  perform pg_advisory_xact_lock(hashtextextended('atendimento:' || p_bot_id || ':' || p_channel || ':' || p_contact_key_hash, 0));
  select a.id, a.answers into v_id, v_answers from public.atendimentos a
  where a.bot_id = p_bot_id and a.channel = p_channel and a.contact_key_hash = p_contact_key_hash
    and a.started_at > now() - interval '24 hours'
  order by a.started_at desc
  limit 1;
  if v_id is not null and v_answers < p_answer_limit then
    update public.atendimentos set answers = answers + 1 where id = v_id;
    return query select 'aberto'::text, v_id, null::int, null::int, null::boolean, null::int, null::int, null::int;
    return;
  end if;

  -- trava do chatbot: a contagem do mês e a inserção não se cruzam com outra abertura
  perform pg_advisory_xact_lock(hashtextextended('atendimentos-bot:' || p_bot_id, 0));
  -- mês civil de São Paulo
  v_start := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_quota := coalesce(
    v_override,
    case when v_size is not null and v_prorated_month = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date then v_prorated_quota end,
    case when v_size = 'volume' then coalesce(v_packs, 0) * coalesce((p_size_quotas ->> 'volume')::int, 0) else (p_size_quotas ->> v_size)::int end,
    0
  );
  select count(*), count(*) filter (where a.overage) into v_used, v_extra from public.atendimentos a where a.bot_id = p_bot_id and a.started_at >= v_start;
  v_price := round(coalesce(p_overage_price, 0) * 100)::int;
  v_max := case when v_cap is null or v_price <= 0 then null else floor(v_cap * 100 / v_price)::int end;

  if v_used - v_extra < v_quota then
    insert into public.atendimentos (agency_id, client_id, bot_id, channel, contact_key_hash, first_conversation_id, answers)
    values (v_agency, v_client, p_bot_id, p_channel, p_contact_key_hash, p_conversation_id, 1)
    returning id into v_id;
    return query select 'novo'::text, v_id, v_used - v_extra + 1, v_quota, v_overage_on, v_extra, v_max, null::int;
    return;
  end if;

  if not v_overage_on or v_quota <= 0 or v_price <= 0 then
    return query select 'cota'::text, null::bigint, v_used - v_extra, v_quota, v_overage_on, v_extra, v_max, null::int;
    return;
  end if;
  if v_suspended_reason is not null then
    return query select 'suspenso'::text, null::bigint, v_used - v_extra, v_quota, true, v_extra, v_max, null::int;
    return;
  end if;
  if v_max is not null and v_extra >= v_max then
    return query select 'teto'::text, null::bigint, v_used - v_extra, v_quota, true, v_extra, v_max, null::int;
    return;
  end if;

  -- pico no widget: suspende o excedente do chatbot até o dono confirmar
  if p_channel = 'widget' and (v_spike_ok_until is null or v_spike_ok_until <= now()) then
    select count(*) filter (where a.started_at > now() - interval '24 hours'),
           count(*) filter (where a.started_at <= now() - interval '24 hours')
    into v_last24, v_before7
    from public.atendimentos a
    where a.bot_id = p_bot_id and a.channel = 'widget' and a.started_at > now() - interval '8 days';
    if v_last24 > greatest(100, 5 * v_before7 / 7.0) then
      update public.bots set overage_suspended_at = now(), overage_suspended_reason = 'pico', overage_suspended_until = null where id = p_bot_id;
      return query select 'pico'::text, null::bigint, v_used - v_extra, v_quota, true, v_extra, v_max, null::int;
      return;
    end if;
  end if;

  -- crédito da conta: trava do saldo, desconta dos lotes que vencem antes
  perform pg_advisory_xact_lock(hashtextextended('credito:' || v_agency, 0));
  v_balance := public.credit_balance(v_agency);
  if v_balance < v_price then
    return query select 'sem_credito'::text, null::bigint, v_used - v_extra, v_quota, true, v_extra, v_max, v_balance;
    return;
  end if;
  v_need := v_price;
  for v_lot in
    select l.id, l.remaining_cents from public.credit_lots l
    where l.agency_id = v_agency and l.remaining_cents > 0 and l.expires_at > now()
    order by l.expires_at, l.id
    for update
  loop
    exit when v_need <= 0;
    v_take := least(v_lot.remaining_cents, v_need);
    update public.credit_lots set remaining_cents = remaining_cents - v_take where id = v_lot.id;
    v_need := v_need - v_take;
  end loop;
  insert into public.atendimentos (agency_id, client_id, bot_id, channel, contact_key_hash, first_conversation_id, answers, overage, credit_cents)
  values (v_agency, v_client, p_bot_id, p_channel, p_contact_key_hash, p_conversation_id, 1, true, v_price)
  returning id into v_id;
  return query select 'excedente'::text, v_id, v_used - v_extra, v_quota, true, v_extra + 1, v_max, v_balance - v_price;
end;
$$;
revoke all on function public.open_atendimento(uuid, text, text, uuid, jsonb, int, numeric) from public, anon, authenticated;
grant execute on function public.open_atendimento(uuid, text, text, uuid, jsonb, int, numeric) to service_role;

notify pgrst, 'reload schema';

-- Boavoz · cobrança por tamanho na Stripe (revisão de preços, parte 4a; 16/10/2026).
-- Uma assinatura por conta, com a fatura sempre no dia 1º (mês civil de São Paulo, como a cota).
-- Subir de tamanho vale na hora, com a diferença proporcional cobrada e a cota proporcional ao
-- resto do mês; descer ou tirar o tamanho vale no dia 1º (troca agendada). Pacotes da conta
-- (domínio próprio, integrações, plataforma) em agency_packs. Pagamento atrasado suspende o
-- excedente. Idempotente.

-- situação da assinatura: sem assinatura, em dia ou com pagamento atrasado
alter table public.agencies add column if not exists billing_status text not null default 'none';
alter table public.agencies drop constraint if exists agencies_billing_status_check;
alter table public.agencies add constraint agencies_billing_status_check check (billing_status in ('none', 'active', 'past_due'));

-- troca agendada (descer ou tirar o tamanho): vale a partir de pending_from (o dia 1º seguinte)
alter table public.bots add column if not exists pending_size text;
alter table public.bots add column if not exists pending_volume_packs int;
alter table public.bots add column if not exists pending_from timestamptz;
alter table public.bots drop constraint if exists bots_pending_size_check;
alter table public.bots add constraint bots_pending_size_check check (
  (pending_size is null or pending_size in ('P', 'M', 'G', 'volume', 'none'))
  and (pending_size is distinct from 'volume' or coalesce(pending_volume_packs, 0) >= 1)
  and ((pending_size is null) = (pending_from is null))
);
-- cota do mês em que o chatbot ganhou ou subiu de tamanho: proporcional ao resto do mês
alter table public.bots add column if not exists prorated_month date;
alter table public.bots add column if not exists prorated_quota int;
alter table public.bots drop constraint if exists bots_prorated_check;
alter table public.bots add constraint bots_prorated_check check ((prorated_month is null) = (prorated_quota is null) and (prorated_quota is null or prorated_quota >= 0));

-- tamanho, cota, excedente e a cobrança só mudam pelo servidor
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
      new.pending_size := null;
      new.pending_volume_packs := null;
      new.pending_from := null;
      new.prorated_month := null;
      new.prorated_quota := null;
    elsif new.size is distinct from old.size or new.volume_packs is distinct from old.volume_packs or new.quota_override is distinct from old.quota_override
      or new.overage_enabled is distinct from old.overage_enabled or new.overage_cap_brl is distinct from old.overage_cap_brl
      or new.pending_size is distinct from old.pending_size or new.pending_volume_packs is distinct from old.pending_volume_packs or new.pending_from is distinct from old.pending_from
      or new.prorated_month is distinct from old.prorated_month or new.prorated_quota is distinct from old.prorated_quota then
      raise exception 'o tamanho, a cota e o excedente do chatbot só mudam pelo servidor' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- pacotes da conta; ends_at = sai no dia 1º (já pago até lá)
create table if not exists public.agency_packs (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  pack text not null check (pack in ('dominio', 'integracoes', 'plataforma')),
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  primary key (agency_id, pack)
);
alter table public.agency_packs enable row level security;
drop policy if exists agency_packs_read on public.agency_packs;
create policy agency_packs_read on public.agency_packs for select to authenticated using (agency_id = public.my_agency_id());

-- compra esperando pagamento (o Checkout da primeira assinatura, a fatura avulsa de quem sobe):
-- aplicada uma vez só, quando a Stripe confirma. Só o servidor lê e grava.
create table if not exists public.billing_changes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  kind text not null check (kind in ('checkout', 'upgrade')),
  target jsonb not null,
  amount_cents int,
  stripe_ref text,
  status text not null default 'pending' check (status in ('pending', 'applied', 'void')),
  created_by uuid,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists billing_changes_agency_idx on public.billing_changes (agency_id, created_at desc);
alter table public.billing_changes enable row level security;

-- aplica as trocas agendadas que já venceram (o dia 1º chegou), sem a cota proporcional do
-- tamanho antigo; devolve quantas
create or replace function public.apply_due_bot_changes(p_agency_id uuid) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.bots set
    size = case when pending_size = 'none' then null else pending_size end,
    volume_packs = case when pending_size = 'volume' then pending_volume_packs else null end,
    pending_size = null, pending_volume_packs = null, pending_from = null,
    prorated_month = null, prorated_quota = null
  where agency_id = p_agency_id and pending_from is not null and pending_from <= now();
  get diagnostics v_count = row_count;
  delete from public.agency_packs where agency_id = p_agency_id and ends_at is not null and ends_at <= now();
  return v_count;
end;
$$;
revoke all on function public.apply_due_bot_changes(uuid) from public, anon, authenticated;
grant execute on function public.apply_due_bot_changes(uuid) to service_role;

/*
 * Aplica uma compra paga, uma vez só (pending -> applied): os tamanhos e a cota proporcional de
 * cada chatbot (calculados no servidor), os pacotes e a assinatura. p_replace_packs: na primeira
 * assinatura, os pacotes ficam exatamente os da compra. Devolve false se já tinha sido aplicada.
 */
create or replace function public.apply_billing_change(
  p_change_id uuid,
  p_bots jsonb,
  p_packs text[],
  p_replace_packs boolean,
  p_subscription_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
begin
  update public.billing_changes set status = 'applied', applied_at = now()
  where id = p_change_id and status = 'pending'
  returning agency_id into v_agency;
  if v_agency is null then
    return false;
  end if;

  update public.bots b set
    size = x.size,
    volume_packs = x.volume_packs,
    pending_size = null, pending_volume_packs = null, pending_from = null,
    prorated_month = x.prorated_month,
    prorated_quota = x.prorated_quota
  from jsonb_to_recordset(coalesce(p_bots, '[]'::jsonb)) as x(id uuid, size text, volume_packs int, prorated_month date, prorated_quota int)
  where b.id = x.id and b.agency_id = v_agency;

  if p_replace_packs then
    delete from public.agency_packs where agency_id = v_agency and not (pack = any (coalesce(p_packs, '{}')));
  end if;
  insert into public.agency_packs (agency_id, pack)
  select v_agency, p from unnest(coalesce(p_packs, '{}')) p
  on conflict (agency_id, pack) do update set ends_at = null;

  if p_subscription_id is not null then
    update public.agencies set stripe_subscription_id = p_subscription_id, billing_status = 'active' where id = v_agency;
  end if;
  return true;
end;
$$;
revoke all on function public.apply_billing_change(uuid, jsonb, text[], boolean, text) from public, anon, authenticated;
grant execute on function public.apply_billing_change(uuid, jsonb, text[], boolean, text) to service_role;

/*
 * Como a 0095, mais: aplica a troca agendada vencida do chatbot, usa a cota proporcional no mês
 * em que ele ganhou ou subiu de tamanho, e não abre excedente com o pagamento atrasado.
 */
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
  v_pending_from timestamptz;
  v_prorated_month date;
  v_prorated_quota int;
  v_past_due boolean;
  v_id bigint;
  v_answers int;
  v_quota int;
  v_used int;
  v_extra int;
  v_max int;
  v_start timestamptz;
begin
  select b.agency_id, b.pending_from into v_agency, v_pending_from from public.bots b where b.id = p_bot_id;
  if v_agency is null then
    raise exception 'chatbot não encontrado';
  end if;
  -- o dia 1º chegou: a troca agendada (descer ou tirar o tamanho) vale agora
  if v_pending_from is not null and v_pending_from <= now() then
    update public.bots set
      size = case when pending_size = 'none' then null else pending_size end,
      volume_packs = case when pending_size = 'volume' then pending_volume_packs else null end,
      pending_size = null, pending_volume_packs = null, pending_from = null,
      prorated_month = null, prorated_quota = null
    where id = p_bot_id;
  end if;
  select b.client_id, b.size, b.volume_packs, b.quota_override, b.overage_enabled, b.overage_cap_brl, b.prorated_month, b.prorated_quota, a.billing_status = 'past_due'
  into v_client, v_size, v_packs, v_override, v_overage_on, v_cap, v_prorated_month, v_prorated_quota, v_past_due
  from public.bots b join public.agencies a on a.id = b.agency_id where b.id = p_bot_id;

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
  -- mês civil de São Paulo
  v_start := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_quota := coalesce(
    v_override,
    case when v_size is not null and v_prorated_month = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date then v_prorated_quota end,
    case when v_size = 'volume' then coalesce(v_packs, 0) * coalesce((p_size_quotas ->> 'volume')::int, 0) else (p_size_quotas ->> v_size)::int end,
    0
  );
  select count(*), count(*) filter (where a.overage) into v_used, v_extra from public.atendimentos a where a.bot_id = p_bot_id and a.started_at >= v_start;

  if v_used - v_extra < v_quota then
    insert into public.atendimentos (agency_id, client_id, bot_id, channel, contact_key_hash, first_conversation_id, answers)
    values (v_agency, v_client, p_bot_id, p_channel, p_contact_key_hash, p_conversation_id, 1)
    returning id into v_id;
    return query select 'novo'::text, v_id, v_used - v_extra + 1, v_quota, v_overage_on and not v_past_due, v_extra, null::int;
    return;
  end if;

  if not v_overage_on or v_past_due or v_quota <= 0 or v_cap is null or p_overage_price is null or p_overage_price <= 0 then
    return query select 'cota'::text, null::bigint, v_used - v_extra, v_quota, v_overage_on and not v_past_due, v_extra, null::int;
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

notify pgrst, 'reload schema';

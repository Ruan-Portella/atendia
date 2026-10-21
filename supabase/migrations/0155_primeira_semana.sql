-- Primeira semana da assinatura (leva Trava da conta grátis, parte 3, 21/10/2026). Nos 7 dias do
-- pagamento que abriu a assinatura (agencies.first_paid_at, os mesmos 7 dias da desistência), cada
-- chatbot abre até 25% da cota do mês (contando o excedente): passou disso, open_atendimento devolve
-- 'primeira_semana' e o chatbot passa para a equipe até o 8º dia, como na cota cheia. Quem desiste
-- depois de usar a semana inteira não leva o mês todo de graça. A cota sob medida fica de fora. O
-- limite de R$ 100 de crédito na semana fica no servidor (billing-credit.ts). Igual à 0104 no
-- resto. Idempotente.

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
  v_first_paid timestamptz;
  v_billing text;
begin
  select b.agency_id, b.pending_from into v_agency, v_pending_from from public.bots b where b.id = p_bot_id;
  if v_agency is null then
    raise exception 'chatbot não encontrado';
  end if;
  -- o dia 1º chegou: a troca agendada vale agora (e a cota proporcional do tamanho antigo sai)
  if v_pending_from is not null and v_pending_from <= now() then
    perform public.apply_due_bot_changes(v_agency);
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

  -- primeira semana da assinatura (Trava da conta grátis, parte 3): cada chatbot usa até 25% da cota
  -- do mês (contando o excedente) nos 7 dias do pagamento que abriu a assinatura; no 8º dia, libera
  select ag.first_paid_at, ag.billing_status into v_first_paid, v_billing from public.agencies ag where ag.id = v_agency;
  if v_override is null and v_quota > 0 and v_first_paid is not null and v_billing <> 'none'
     and now() < v_first_paid + interval '7 days' and v_used >= ceil(v_quota * 0.25) then
    return query select 'primeira_semana'::text, null::bigint, v_used - v_extra, v_quota, v_overage_on, v_extra, v_max, null::int;
    return;
  end if;

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

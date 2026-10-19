-- Boavoz · brechas da assinatura (revisão de preços, parte 5d; 18/10/2026).
-- 1) Demos: cada demo vale 14 dias e responde até 50 vezes, com ou sem assinatura (as da vitrine
--    do site também); na conta grátis, as respostas também saem das 50 de teste da conta.
--    use_test_answer passa a olhar o chatbot e devolve o motivo da recusa.
-- 2) Sem prazo de 30 dias para o chatbot que perde o tamanho: os canais desconectam na hora
--    (sai bots.grace_until).
-- 3) A demo (contador e validade) só muda pelo servidor, e a sessão não transforma chatbot em demo.
-- Idempotente.

alter table public.bots add column if not exists demo_answers_used int not null default 0;
alter table public.bots add column if not exists demo_expires_at timestamptz;
update public.bots set demo_expires_at = created_at + interval '14 days' where is_demo and demo_expires_at is null;

/*
 * Reserva uma resposta de teste da IA (teste ao vivo do painel e demos). Devolve:
 *   ok            pode responder
 *   demo_vencida  a demo passou dos 14 dias
 *   demo_limite   a demo já respondeu p_demo_limit vezes
 *   conta         a conta grátis usou as p_limit respostas de teste (ou o chatbot não existe)
 * Com assinatura, na vitrine do site ou com cota sob medida, a resposta não sai da conta (a demo
 * conta sempre).
 */
drop function if exists public.use_test_answer(uuid, int);
create or replace function public.use_test_answer(p_bot_id uuid, p_limit int, p_demo_limit int) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_demo boolean;
  v_expires timestamptz;
  v_override int;
  v_status text;
  v_slug text;
begin
  select b.agency_id, b.is_demo, b.demo_expires_at, b.quota_override, a.billing_status, a.slug
  into v_agency, v_demo, v_expires, v_override, v_status, v_slug
  from public.bots b join public.agencies a on a.id = b.agency_id
  where b.id = p_bot_id;
  if v_agency is null then
    return 'conta';
  end if;
  if v_demo then
    if v_expires is not null and v_expires <= now() then
      return 'demo_vencida';
    end if;
    update public.bots set demo_answers_used = demo_answers_used + 1 where id = p_bot_id and demo_answers_used < p_demo_limit;
    if not found then
      return 'demo_limite';
    end if;
  end if;
  if v_status <> 'none' or v_slug = 'boavoz' or v_override is not null then
    return 'ok';
  end if;
  update public.agencies set test_answers_used = test_answers_used + 1 where id = v_agency and test_answers_used < p_limit;
  if not found then
    -- a conta acabou: a resposta da demo não saiu
    if v_demo then
      update public.bots set demo_answers_used = demo_answers_used - 1 where id = p_bot_id;
    end if;
    return 'conta';
  end if;
  return 'ok';
end;
$$;
revoke all on function public.use_test_answer(uuid, int, int) from public, anon, authenticated;
grant execute on function public.use_test_answer(uuid, int, int) to service_role;

-- a guarda do tamanho sem o prazo; a demo (contador e validade) também só muda pelo servidor
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
      new.demo_answers_used := 0;
      new.demo_expires_at := null;
    elsif new.size is distinct from old.size or new.volume_packs is distinct from old.volume_packs or new.quota_override is distinct from old.quota_override
      or new.overage_enabled is distinct from old.overage_enabled or new.overage_cap_brl is distinct from old.overage_cap_brl
      or new.pending_size is distinct from old.pending_size or new.pending_volume_packs is distinct from old.pending_volume_packs or new.pending_from is distinct from old.pending_from
      or new.prorated_month is distinct from old.prorated_month or new.prorated_quota is distinct from old.prorated_quota
      or new.overage_suspended_at is distinct from old.overage_suspended_at or new.overage_suspended_reason is distinct from old.overage_suspended_reason
      or new.overage_suspended_until is distinct from old.overage_suspended_until or new.overage_spike_ok_until is distinct from old.overage_spike_ok_until
      or new.demo_answers_used is distinct from old.demo_answers_used or new.demo_expires_at is distinct from old.demo_expires_at
      or (new.is_demo and not old.is_demo) then
      raise exception 'o tamanho, a cota, o excedente e a demo do chatbot só mudam pelo servidor' using errcode = '42501';
    end if;
  end if;
  -- demo nova: vale 14 dias
  if tg_op = 'INSERT' and new.is_demo and new.demo_expires_at is null then
    new.demo_expires_at := now() + interval '14 days';
  end if;
  return new;
end;
$$;

alter table public.bots drop column if exists grace_until;

notify pgrst, 'reload schema';

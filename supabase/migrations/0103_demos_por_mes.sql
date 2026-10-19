-- Boavoz · demos por mês (revisão de preços, parte 5e; 18/10/2026).
-- 1) A conta gera até 3 demos por mês na conta grátis e até 20 com assinatura (mês civil de São
--    Paulo), contadas na criação: apagar uma demo não devolve a vaga; demo que não conseguiu ler o
--    site devolve. A vitrine do site (slug 'boavoz') fica de fora: lá valem os limites por IP e o
--    teto diário.
-- 2) A demo da vitrine responde até p_showcase_demo_limit vezes (20); as outras, p_demo_limit (50).
-- O contador só muda pelo servidor (a sessão não tem update nessas colunas, migração 0040).
-- Idempotente.

alter table public.agencies add column if not exists demo_month date;
alter table public.agencies add column if not exists demo_month_count int not null default 0;

/* Reserva a criação de uma demo neste mês. false = a conta chegou ao limite (ou não existe). */
create or replace function public.claim_demo(p_agency_id uuid, p_free_limit int, p_paid_limit int) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  v_status text;
  v_slug text;
  v_limit int;
begin
  select billing_status, slug into v_status, v_slug from public.agencies where id = p_agency_id;
  if v_status is null then
    return false;
  end if;
  if v_slug = 'boavoz' then
    return true;
  end if;
  v_limit := case when v_status = 'none' then p_free_limit else p_paid_limit end;
  update public.agencies
  set demo_month = v_month, demo_month_count = case when demo_month = v_month then demo_month_count + 1 else 1 end
  where id = p_agency_id and v_limit >= 1 and (demo_month is distinct from v_month or demo_month_count < v_limit);
  return found;
end;
$$;

/* Devolve a vaga de uma demo que não chegou a existir (site que não deu para ler). */
create or replace function public.release_demo(p_agency_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.agencies set demo_month_count = demo_month_count - 1
  where id = p_agency_id and demo_month = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date and demo_month_count > 0;
end;
$$;

revoke all on function public.claim_demo(uuid, int, int) from public, anon, authenticated;
grant execute on function public.claim_demo(uuid, int, int) to service_role;
revoke all on function public.release_demo(uuid) from public, anon, authenticated;
grant execute on function public.release_demo(uuid) to service_role;

/*
 * Reserva uma resposta de teste da IA (teste ao vivo do painel e demos). Igual à 0102, com o
 * limite próprio das demos da vitrine do site. Devolve ok, demo_vencida, demo_limite ou conta.
 */
drop function if exists public.use_test_answer(uuid, int, int);
create or replace function public.use_test_answer(p_bot_id uuid, p_limit int, p_demo_limit int, p_showcase_demo_limit int) returns text
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
    update public.bots set demo_answers_used = demo_answers_used + 1
    where id = p_bot_id and demo_answers_used < case when v_slug = 'boavoz' then p_showcase_demo_limit else p_demo_limit end;
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
revoke all on function public.use_test_answer(uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.use_test_answer(uuid, int, int, int) to service_role;

notify pgrst, 'reload schema';

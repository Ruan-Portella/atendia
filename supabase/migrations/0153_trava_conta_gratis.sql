-- Trava da conta grátis (leva Trava da conta grátis, parte 1, 21/10/2026). O teste grátis (as 50
-- respostas de teste e as demos) vale uma vez por pessoa, não por conta. Cada conta guarda sinais
-- de quem é o dono, só como HMAC (nunca o valor): o e-mail normalizado (Gmail sem ponto e sem
-- +apelido), o navegador (cookie próprio), o IP do cadastro, o WhatsApp confirmado do dono e, na
-- assinatura (parte 2), o CPF ou CNPJ e o cartão. Antes da primeira resposta de teste ou da
-- primeira demo, a conta confere se outra conta da mesma pessoa (viva ou excluída) já usou o teste
-- ou assinou: se usou, esta fica sem o teste grátis. O IP sozinho é fraco (CGNAT): só pesa com 3
-- outras contas do mesmo IP, criadas a menos de 24 horas desta, que já usaram o teste. O suporte
-- libera a conta presa por engano (free_released_at). Os sinais de uma conta excluída ficam 12
-- meses (orphaned_at) e saem na tarefa diária. Sem policy: só o servidor lê e escreve. Idempotente.

create table if not exists public.person_signals (
  id bigint generated always as identity primary key,
  agency_id uuid references public.agencies(id) on delete set null,
  kind text not null check (kind in ('email', 'device', 'ip', 'phone', 'doc', 'card')),
  value_hash text not null check (char_length(value_hash) = 64),
  created_at timestamptz not null default now(),
  free_used_at timestamptz,
  orphaned_at timestamptz
);
create unique index if not exists person_signals_agency_idx on public.person_signals (agency_id, kind, value_hash) where agency_id is not null;
create index if not exists person_signals_value_idx on public.person_signals (kind, value_hash);
create index if not exists person_signals_orphan_idx on public.person_signals (orphaned_at) where orphaned_at is not null;
alter table public.person_signals enable row level security;
revoke all on public.person_signals from anon, authenticated;
grant all on public.person_signals to service_role;

alter table public.agencies add column if not exists free_used_at timestamptz;
alter table public.agencies add column if not exists free_blocked_at timestamptz;
alter table public.agencies add column if not exists free_block_reason text;
alter table public.agencies add column if not exists free_released_at timestamptz;
alter table public.agencies drop constraint if exists agencies_free_block_reason_check;
alter table public.agencies add constraint agencies_free_block_reason_check check (free_block_reason is null or free_block_reason in ('email', 'device', 'ip', 'phone', 'doc', 'card', 'marca'));

-- as contas que já usaram o teste antes desta migração
update public.agencies a set free_used_at = now()
where a.free_used_at is null and (a.test_answers_used > 0 or a.demo_month_count > 0 or exists (select 1 from public.bots b where b.agency_id = a.id and b.is_demo));

/* A conta excluída deixa os sinais por 12 meses (e, se assinou, como quem já usou o teste). */
create or replace function public.person_signals_orphan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.person_signals
  set orphaned_at = now(), free_used_at = coalesce(free_used_at, old.free_used_at, case when old.billing_status <> 'none' then now() end)
  where agency_id = old.id;
  return old;
end $$;
drop trigger if exists agencies_person_signals_orphan on public.agencies;
create trigger agencies_person_signals_orphan before delete on public.agencies
  for each row execute function public.person_signals_orphan();

/* Grava os sinais de uma conta (repetido não duplica); herdam o "já usou o teste" da conta. */
create or replace function public.add_person_signals(p_agency_id uuid, p_kinds text[], p_hashes text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_used timestamptz;
begin
  select free_used_at into v_used from public.agencies where id = p_agency_id;
  if not found then
    return;
  end if;
  insert into public.person_signals (agency_id, kind, value_hash, free_used_at)
  select p_agency_id, t.k, t.h, v_used from unnest(p_kinds, p_hashes) as t(k, h)
  on conflict (agency_id, kind, value_hash) where agency_id is not null do nothing;
end $$;

/* A conta usou o teste grátis (a primeira resposta de teste ou a primeira demo). */
create or replace function public.mark_free_used(p_agency_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.agencies set free_used_at = now() where id = p_agency_id and free_used_at is null;
  if found then
    update public.person_signals set free_used_at = now() where agency_id = p_agency_id and free_used_at is null;
  end if;
end $$;

/*
 * O sinal que liga esta conta a outra da mesma pessoa que já usou o teste ou assinou (null: nenhum).
 * Os fortes primeiro (número, documento, cartão, e-mail, navegador); o IP só com 3 contas.
 */
create or replace function public.free_link_reason(p_agency_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
begin
  select s1.kind into v_kind
  from public.person_signals s1
  join public.person_signals s2 on s2.kind = s1.kind and s2.value_hash = s1.value_hash and s2.agency_id is distinct from p_agency_id
  left join public.agencies a2 on a2.id = s2.agency_id
  where s1.agency_id = p_agency_id and s1.kind <> 'ip'
    and (s2.free_used_at is not null or coalesce(a2.billing_status, 'none') <> 'none')
  order by array_position(array['phone', 'doc', 'card', 'email', 'device'], s1.kind)
  limit 1;
  if v_kind is not null then
    return v_kind;
  end if;
  if (
    select count(distinct s2.agency_id)
    from public.person_signals s1
    join public.person_signals s2 on s2.kind = 'ip' and s2.value_hash = s1.value_hash and s2.agency_id is distinct from p_agency_id
    where s1.agency_id = p_agency_id and s1.kind = 'ip' and s2.free_used_at is not null
      and abs(extract(epoch from (s2.created_at - s1.created_at))) < 86400
  ) >= 3 then
    return 'ip';
  end if;
  return null;
end $$;

/*
 * A porta do teste grátis: 'ok' ou 'ligada'. Confere só antes do primeiro uso (quem já está usando
 * segue até o fim das 50); a liberação do suporte vale sempre.
 */
create or replace function public.free_gate(p_agency_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_used timestamptz;
  v_blocked timestamptz;
  v_released timestamptz;
  v_reason text;
begin
  select free_used_at, free_blocked_at, free_released_at into v_used, v_blocked, v_released from public.agencies where id = p_agency_id;
  if v_released is not null then
    return 'ok';
  end if;
  if v_blocked is not null then
    return 'ligada';
  end if;
  if v_used is not null then
    return 'ok';
  end if;
  v_reason := public.free_link_reason(p_agency_id);
  if v_reason is null then
    return 'ok';
  end if;
  update public.agencies set free_blocked_at = now(), free_block_reason = v_reason where id = p_agency_id;
  return 'ligada';
end $$;

/* Igual à 0103, com a porta do teste grátis antes da primeira demo da conta grátis. */
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
  if v_status = 'none' and public.free_gate(p_agency_id) = 'ligada' then
    return false;
  end if;
  v_limit := case when v_status = 'none' then p_free_limit else p_paid_limit end;
  update public.agencies
  set demo_month = v_month, demo_month_count = case when demo_month = v_month then demo_month_count + 1 else 1 end
  where id = p_agency_id and v_limit >= 1 and (demo_month is distinct from v_month or demo_month_count < v_limit);
  if not found then
    return false;
  end if;
  if v_status = 'none' then
    perform public.mark_free_used(p_agency_id);
  end if;
  return true;
end;
$$;

/*
 * Igual à 0103, com a porta do teste grátis: devolve ok, demo_vencida, demo_limite, conta ou
 * ligada (a conta está ligada a outra da mesma pessoa que já usou o teste).
 */
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
  if public.free_gate(v_agency) = 'ligada' then
    if v_demo then
      update public.bots set demo_answers_used = demo_answers_used - 1 where id = p_bot_id;
    end if;
    return 'ligada';
  end if;
  update public.agencies set test_answers_used = test_answers_used + 1 where id = v_agency and test_answers_used < p_limit;
  if not found then
    -- a conta acabou: a resposta da demo não saiu
    if v_demo then
      update public.bots set demo_answers_used = demo_answers_used - 1 where id = p_bot_id;
    end if;
    return 'conta';
  end if;
  perform public.mark_free_used(v_agency);
  return 'ok';
end;
$$;

revoke all on function public.person_signals_orphan() from public, anon, authenticated;
revoke all on function public.add_person_signals(uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.add_person_signals(uuid, text[], text[]) to service_role;
revoke all on function public.mark_free_used(uuid) from public, anon, authenticated;
grant execute on function public.mark_free_used(uuid) to service_role;
revoke all on function public.free_link_reason(uuid) from public, anon, authenticated;
grant execute on function public.free_link_reason(uuid) to service_role;
revoke all on function public.free_gate(uuid) from public, anon, authenticated;
grant execute on function public.free_gate(uuid) to service_role;
revoke all on function public.claim_demo(uuid, int, int) from public, anon, authenticated;
grant execute on function public.claim_demo(uuid, int, int) to service_role;
revoke all on function public.use_test_answer(uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.use_test_answer(uuid, int, int, int) to service_role;

-- a sessão não mexe nas colunas da trava (a 0040 restringe o update das agências por coluna)
revoke update (free_used_at, free_blocked_at, free_block_reason, free_released_at) on public.agencies from authenticated;

notify pgrst, 'reload schema';

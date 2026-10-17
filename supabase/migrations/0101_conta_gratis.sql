-- Boavoz · conta grátis (revisão de preços, parte 5b; 17/10/2026).
-- 1) Respostas de teste: sem assinatura, o teste ao vivo do painel e as demos usam até 50 respostas
--    da IA na conta (a vitrine do site, slug 'boavoz', fica de fora). Com assinatura, são livres.
-- 2) Tamanho Atendimento: chatbot no ar sem IA (cota zero), para quem só quer a caixa de entrada.
-- 3) Caixa de entrada grátis: um chatbot sem tamanho por conta fica com WhatsApp e Instagram; os
--    outros chatbots sem tamanho com canal ganham um prazo de 30 dias (grace_until) e depois são
--    desconectados (tarefa diária). Ganhar um tamanho limpa o prazo. Idempotente.

-- respostas de teste já usadas pela conta (sem assinatura)
alter table public.agencies add column if not exists test_answers_used int not null default 0;

/*
 * Reserva uma resposta de teste. Com assinatura, ou na vitrine do site, sempre pode (sem contar).
 * Sem assinatura, conta até p_limit; devolve false quando acabou (ou a conta não existe).
 */
create or replace function public.use_test_answer(p_agency_id uuid, p_limit int) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_free boolean;
begin
  select billing_status <> 'none' or slug = 'boavoz' into v_free from public.agencies where id = p_agency_id;
  if v_free is null then
    return false;
  end if;
  if v_free then
    return true;
  end if;
  update public.agencies set test_answers_used = test_answers_used + 1 where id = p_agency_id and test_answers_used < p_limit;
  return found;
end;
$$;
revoke all on function public.use_test_answer(uuid, int) from public, anon, authenticated;
grant execute on function public.use_test_answer(uuid, int) to service_role;

-- tamanho Atendimento (sem IA)
alter table public.bots drop constraint if exists bots_size_check;
alter table public.bots add constraint bots_size_check check (size is null or size in ('P', 'M', 'G', 'volume', 'atendimento'));
alter table public.bots drop constraint if exists bots_pending_size_check;
alter table public.bots add constraint bots_pending_size_check check (
  (pending_size is null or pending_size in ('P', 'M', 'G', 'volume', 'atendimento', 'none'))
  and (pending_size is distinct from 'volume' or coalesce(pending_volume_packs, 0) >= 1)
  and ((pending_size is null) = (pending_from is null))
);

-- prazo do chatbot sem tamanho fora da caixa grátis: os canais desconectam nesta data
alter table public.bots add column if not exists grace_until timestamptz;

-- o prazo também só muda pelo servidor; ganhar um tamanho (ou cota sob medida) limpa o prazo
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
      new.grace_until := null;
    elsif new.size is distinct from old.size or new.volume_packs is distinct from old.volume_packs or new.quota_override is distinct from old.quota_override
      or new.overage_enabled is distinct from old.overage_enabled or new.overage_cap_brl is distinct from old.overage_cap_brl
      or new.pending_size is distinct from old.pending_size or new.pending_volume_packs is distinct from old.pending_volume_packs or new.pending_from is distinct from old.pending_from
      or new.prorated_month is distinct from old.prorated_month or new.prorated_quota is distinct from old.prorated_quota
      or new.overage_suspended_at is distinct from old.overage_suspended_at or new.overage_suspended_reason is distinct from old.overage_suspended_reason
      or new.overage_suspended_until is distinct from old.overage_suspended_until or new.overage_spike_ok_until is distinct from old.overage_spike_ok_until
      or new.grace_until is distinct from old.grace_until then
      raise exception 'o tamanho, a cota e o excedente do chatbot só mudam pelo servidor' using errcode = '42501';
    end if;
  elsif new.size is not null or new.quota_override is not null then
    new.grace_until := null;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';

-- Desistência em 7 dias (leva Trava da conta grátis, parte 2, 21/10/2026; art. 49 do CDC e Decreto
-- 7.962/2013). Nos 7 dias do pagamento que abriu a assinatura atual (first_paid_at, refeito a cada
-- assinatura nova), o dono desiste pelo
-- painel: o BoaVoz estorna o que foi pago desde então, encerra a assinatura na hora e a conta volta
-- para a conta grátis, sem o teste. A pessoa (os sinais da conta, menos o IP) fica marcada por 12
-- meses (person_marks): nenhuma conta dela ganha o teste grátis, e a desistência de uma assinatura
-- nova vai para o suporte. Cada desistência fica registrada (withdrawals), e as notas a emitir dos
-- pagamentos estornados saem da fila (estornada). Sem policy: só o servidor lê e escreve. Idempotente.

alter table public.agencies add column if not exists first_paid_at timestamptz;
alter table public.agencies add column if not exists withdrawn_at timestamptz;
-- as contas que já assinaram antes desta migração: o primeiro pagamento registrado
update public.agencies a set first_paid_at = (select min(f.paid_at) from public.fiscal_invoices f where f.agency_id = a.id)
where a.first_paid_at is null and a.billing_status <> 'none';
revoke update (first_paid_at, withdrawn_at) on public.agencies from authenticated;

create table if not exists public.person_marks (
  id bigint generated always as identity primary key,
  agency_id uuid references public.agencies(id) on delete set null,
  kind text not null check (kind in ('email', 'device', 'phone', 'doc', 'card')),
  value_hash text not null check (char_length(value_hash) = 64),
  reason text not null check (reason in ('desistencia')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists person_marks_value_idx on public.person_marks (kind, value_hash);
create index if not exists person_marks_expires_idx on public.person_marks (expires_at);
alter table public.person_marks enable row level security;
revoke all on public.person_marks from anon, authenticated;
grant all on public.person_marks to service_role;

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references public.agencies(id) on delete set null,
  via text not null check (via in ('painel', 'suporte')),
  actor text not null,
  reason text check (reason is null or char_length(reason) <= 200),
  refunded_cents int not null default 0,
  refund_ids text[] not null default '{}',
  status text not null check (status in ('feita', 'erro')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists withdrawals_agency_idx on public.withdrawals (agency_id, created_at desc);
alter table public.withdrawals enable row level security;
revoke all on public.withdrawals from anon, authenticated;
grant all on public.withdrawals to service_role;

alter table public.fiscal_invoices add column if not exists refunded_at timestamptz;
alter table public.fiscal_invoices drop constraint if exists fiscal_invoices_status_check;
alter table public.fiscal_invoices add constraint fiscal_invoices_status_check check (status in ('a_emitir', 'emitida', 'erro', 'estornada'));

/* A pessoa da conta está marcada (desistência nos últimos 12 meses), por algum sinal. */
create or replace function public.person_marked(p_agency_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.person_signals s
    join public.person_marks m on m.kind = s.kind and m.value_hash = s.value_hash
    where s.agency_id = p_agency_id and m.expires_at > now()
  );
$$;

/* Marca a pessoa da conta por p_months meses (os sinais dela, menos o IP). Devolve quantos. */
create or replace function public.mark_person(p_agency_id uuid, p_reason text, p_months int) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  insert into public.person_marks (agency_id, kind, value_hash, reason, expires_at)
  select distinct p_agency_id, s.kind, s.value_hash, p_reason, now() + make_interval(months => p_months)
  from public.person_signals s
  where s.agency_id = p_agency_id and s.kind <> 'ip';
  get diagnostics n = row_count;
  return n;
end $$;

/* Igual à 0153, com a marca da desistência antes de tudo. */
create or replace function public.free_link_reason(p_agency_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
begin
  if public.person_marked(p_agency_id) then
    return 'marca';
  end if;
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

revoke all on function public.person_marked(uuid) from public, anon, authenticated;
grant execute on function public.person_marked(uuid) to service_role;
revoke all on function public.mark_person(uuid, text, int) from public, anon, authenticated;
grant execute on function public.mark_person(uuid, text, int) to service_role;
revoke all on function public.free_link_reason(uuid) from public, anon, authenticated;
grant execute on function public.free_link_reason(uuid) to service_role;

notify pgrst, 'reload schema';

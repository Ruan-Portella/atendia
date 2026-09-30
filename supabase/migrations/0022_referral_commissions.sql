-- Boavoz · comissão de afiliado por fatura
-- Idempotente.

-- Uma linha por fatura paga da agência indicada. A chave é o id da fatura no Stripe: o webhook
-- grava com "on conflict do nothing", então o mesmo evento entregue duas vezes (o Stripe reenvia)
-- não paga a comissão em dobro. referrals.commission_cents vira a soma desta tabela.
create table if not exists public.referral_commissions (
  invoice_id text primary key,
  referral_id uuid not null references public.referrals(id) on delete cascade,
  base_cents int not null,        -- mensalidade do plano na fatura (sem pacotes e ajustes)
  commission_cents int not null,
  created_at timestamptz not null default now()
);
create index if not exists referral_commissions_referral_idx on public.referral_commissions (referral_id);

alter table public.referral_commissions enable row level security;
drop policy if exists referral_commissions_owner on public.referral_commissions;
create policy referral_commissions_owner on public.referral_commissions for select
  using (referral_id in (select id from public.referrals where referrer_id = (select public.my_agency_id())));

-- o que já foi acumulado antes desta tabela entra como uma linha "legado" por indicação
insert into public.referral_commissions (invoice_id, referral_id, base_cents, commission_cents)
select 'legado:' || id, id, 0, commission_cents from public.referrals where commission_cents > 0
on conflict (invoice_id) do nothing;

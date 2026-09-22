-- Atendia · comissão de afiliado vira crédito na assinatura
-- Rode no SQL Editor do Supabase depois da 0002.
--
-- referrals.commission_cents continua sendo o total GERADO por cada indicação (nunca diminui).
-- agencies.credit_redeemed_cents é quanto a agência já converteu em desconto.
-- Disponível = soma(commission_cents das indicações) - credit_redeemed_cents.

alter table public.agencies
  add column if not exists credit_redeemed_cents int not null default 0;

create table if not exists public.credit_redemptions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  stripe_balance_txn_id text,                -- id do customer balance transaction no Stripe
  created_at timestamptz not null default now()
);
create index if not exists credit_redemptions_agency_idx on public.credit_redemptions(agency_id, created_at desc);

alter table public.credit_redemptions enable row level security;
drop policy if exists credit_redemptions_owner on public.credit_redemptions;
create policy credit_redemptions_owner on public.credit_redemptions for select using (agency_id = public.my_agency_id());

-- Boavoz · fim do programa de afiliados (revisão de preços, 16/10/2026).
-- Sem clientes na produção: os dados saem junto com o código (f047fa0), sem transição.
-- As políticas de RLS das duas tabelas caem com elas.
drop table if exists public.referral_commissions;
drop table if exists public.referrals;

alter table public.agencies drop column if exists referral_code;
alter table public.agencies drop column if exists referred_by;
alter table public.agencies drop column if exists credit_redeemed_cents;

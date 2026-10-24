-- Boavoz · lista de espera (24/10/2026): o terceiro público da landing, o SaaS (a plataforma que dá
-- um assistente a cada cliente dela, pela API). Idempotente.

alter table public.waitlist drop constraint if exists waitlist_profile_check;
alter table public.waitlist add constraint waitlist_profile_check check (profile in ('agency', 'business', 'saas'));

-- Boavoz · primeiro acesso (Entrada e docs, parte 1, 19/10/2026): o perfil da conta (agência,
-- o próprio negócio ou integração pela API), respondido pelo dono no primeiro acesso, muda os
-- primeiros passos do painel. null = ainda não respondeu: o painel leva o dono a /comecar.
-- Ver src/lib/first-access.ts. Idempotente.
alter table public.agencies add column if not exists profile text check (profile in ('agency', 'business', 'developer'));

notify pgrst, 'reload schema';

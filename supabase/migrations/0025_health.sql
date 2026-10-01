-- Boavoz · /api/health (L1, passo 1)
-- Idempotente.

-- Uma linha só: o health grava aqui para provar que o banco aceita escrita (com 95% do disco
-- no plano Free o Supabase deixa o banco só leitura e todos os bots param).
create table if not exists public.health_checks (
  id int primary key default 1 check (id = 1),
  checked_at timestamptz not null default now()
);
alter table public.health_checks enable row level security;

-- Tamanho do banco em bytes, para o aviso de disco.
create or replace function public.db_size_bytes()
returns bigint language sql stable security definer set search_path = public as $$
  select pg_database_size(current_database());
$$;
revoke all on function public.db_size_bytes() from public, anon, authenticated;

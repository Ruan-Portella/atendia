-- Boavoz · lista de espera (24/10/2026): até o lançamento (o Instagram no ar), a landing da produção
-- leva para a lista em vez do cadastro. A pessoa deixa o e-mail, o nome e se é agência ou o próprio
-- negócio; o backoffice convida, e só quem foi convidado cria a conta (NEXT_PUBLIC_WAITLIST=1).
-- Só o servidor lê e grava (sem política para a sessão). Idempotente.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  profile text not null default 'agency' check (profile in ('agency', 'business')),
  company text,
  -- agência: quantos clientes atende hoje; negócio: quantas conversas por mês (faixa escolhida)
  size_band text,
  source text,
  ip_hash text,
  created_at timestamptz not null default now(),
  invited_at timestamptz,
  invited_by text,
  joined_at timestamptz,
  check (email = lower(email) and length(email) <= 254),
  check (name is null or length(name) <= 80),
  check (company is null or length(company) <= 120),
  check (size_band is null or length(size_band) <= 40),
  check (source is null or length(source) <= 120)
);
create unique index if not exists waitlist_email_key on public.waitlist (email);
create index if not exists waitlist_created_idx on public.waitlist (created_at);

alter table public.waitlist enable row level security;
revoke all on public.waitlist from anon, authenticated;
grant all on public.waitlist to service_role;

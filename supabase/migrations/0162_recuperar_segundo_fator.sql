-- Recuperação do segundo fator pelo suporte (itens menores da conferência de 20/10, parte 4; spec,
-- Segurança: "Recuperação pelo suporte com confirmação por e-mail, espera de 48 horas e auditoria").
-- Quem perdeu o app autenticador pede na tela de verificação (painel ou área do cliente). O pedido
-- só vale depois do link do e-mail (24 horas para confirmar); confirmado, o suporte só consegue
-- remover o fator 48 horas depois (available_at), no backoffice. O "Não fui eu" do e-mail cancela,
-- e o código do app usado nesse meio tempo também. Um pedido em aberto por pessoa. Os fechados
-- saem depois de 1 ano (a tarefa diária). Sem policy: só o servidor lê. Idempotente.

create table if not exists public.mfa_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  area text not null check (area in ('painel', 'cliente')),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  token_hash text not null unique,
  status text not null default 'pendente' check (status in ('pendente', 'confirmado', 'feito', 'cancelado', 'recusado', 'vencido')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  available_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  close_note text check (close_note is null or char_length(close_note) <= 300),
  check (status <> 'confirmado' or (confirmed_at is not null and available_at is not null))
);
create unique index if not exists mfa_recovery_open_idx on public.mfa_recovery_requests (user_id) where status in ('pendente', 'confirmado');
create index if not exists mfa_recovery_recent_idx on public.mfa_recovery_requests (created_at desc);
create index if not exists mfa_recovery_agency_idx on public.mfa_recovery_requests (agency_id);

alter table public.mfa_recovery_requests enable row level security;
revoke all on public.mfa_recovery_requests from anon, authenticated;
grant all on public.mfa_recovery_requests to service_role;

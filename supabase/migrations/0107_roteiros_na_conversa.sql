-- Boavoz · Roteiros na conversa (leva B2', parte 2a, Peça 6 da spec): o roteiro em andamento de
-- cada conversa (um por vez), com o passo atual, as tentativas do dado e os dados já conferidos,
-- cifrados com a chave do cliente (variables_enc). No fim (concluído ou abandonado, com o motivo), as
-- variáveis saem na hora; a linha fica para os números por roteiro. Só o servidor lê e grava.
-- Idempotente.

create table if not exists public.routine_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  routine_id uuid references public.routines(id) on delete set null,
  -- retrato do roteiro no começo: nome para o painel e versão (updated_at) para saber se mudou
  routine_name text not null,
  routine_version timestamptz not null,
  step_id text not null,
  step_index int not null,
  steps_total int not null,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  end_reason text check (end_reason is null or end_reason in ('handoff', 'timeout', 'routine_changed', 'step_unavailable', 'context_changed', 'cancelled')),
  variables_enc text,
  attempts int not null default 0,
  -- 3 tentativas do dado sem conferir: botões "Falar com a equipe" e "Cancelar"
  failing boolean not null default false,
  started_by text not null check (started_by in ('ia', 'palavra')),
  started_at timestamptz not null default now(),
  last_contact_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index if not exists routine_runs_one_active_idx on public.routine_runs (conversation_id) where status = 'active';
create index if not exists routine_runs_routine_idx on public.routine_runs (routine_id) where status = 'active';
create index if not exists routine_runs_bot_idx on public.routine_runs (bot_id, started_at desc);
create index if not exists routine_runs_timeout_idx on public.routine_runs (last_contact_at) where status = 'active';
alter table public.routine_runs enable row level security;
revoke all on public.routine_runs from anon, authenticated;
grant all on public.routine_runs to service_role;

notify pgrst, 'reload schema';

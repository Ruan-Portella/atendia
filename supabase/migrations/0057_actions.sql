-- Boavoz · Integrações, núcleo da P1 (piloto DuckDelivery): ações de consulta, o segredo de ações
-- do bot e o registro de cada chamada. Configurado à mão pelo BoaVoz (backoffice), sem telas para a
-- agência até a C pública. Ver src/lib/actions.ts. Idempotente.

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  name text not null check (name ~ '^[a-z][a-z0-9_]{1,47}$'),
  description text not null,
  -- na P1 só existe consulta; executa (com confirmação por botão) chega na C pública
  type text not null default 'query' check (type in ('query', 'execute')),
  min_level text not null default 'anonimo' check (min_level in ('anonimo', 'canal', 'usuario')),
  context_required text not null default 'none' check (context_required in ('none', 'signed')),
  outcomes text[] not null default '{}',
  params_schema jsonb not null default '{"type": "object", "properties": {}}'::jsonb,
  supports_preview boolean not null default false,
  url text not null check (url ~ '^https://'),
  -- segredo próprio só quando o host é diferente (ex.: n8n de terceiro); sem ele, o segredo do bot
  secret_enc text,
  headers_enc text,
  active boolean not null default true,
  -- efeito classificado pela IA do BoaVoz no cadastro e na edição (pedido, reserva ou cobrança)
  creates_order boolean,
  creates_order_reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bot_id, name)
);
alter table public.actions enable row level security;
revoke all on public.actions from anon, authenticated;
grant all on public.actions to service_role;

-- um segredo de ações por bot (whsec_), fora da configuração; na troca, o anterior vale 24 horas
alter table public.bots add column if not exists action_secret_enc text;
alter table public.bots add column if not exists action_secret_prev_enc text;
alter table public.bots add column if not exists action_secret_prev_until timestamptz;

-- uma linha por tentativa; log de 30 dias (rotina diária)
create table if not exists public.action_calls (
  id bigserial primary key,
  action_id uuid not null references public.actions(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  call_id text not null,
  attempt int not null default 1,
  params_hash text,
  mode text not null default 'normal' check (mode in ('normal', 'preview', 'test')),
  confirmed boolean not null default false,
  status text not null check (status in ('ok', 'not_found', 'error', 'timeout', 'uncertain', 'blocked')),
  http_status int,
  duration_ms int,
  -- sem cifra até a leva S (como as outras colunas _enc)
  request_enc text,
  response_enc text,
  created_at timestamptz not null default now(),
  unique (call_id, attempt)
);
create index if not exists action_calls_action_idx on public.action_calls (action_id, created_at desc);
create index if not exists action_calls_conversation_idx on public.action_calls (conversation_id);
create index if not exists action_calls_created_idx on public.action_calls (created_at);
alter table public.action_calls enable row level security;
revoke all on public.action_calls from anon, authenticated;
grant all on public.action_calls to service_role;
grant usage, select on sequence public.action_calls_id_seq to service_role;

notify pgrst, 'reload schema';

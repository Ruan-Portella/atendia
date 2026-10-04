-- Boavoz · webhook do piloto (P2): contact.linked e contact.unlinked saem para um webhook
-- configurado à mão no backoffice; o resto dos webhooks nasce na C pública, com o mesmo formato
-- (spec "Formatos de payload", seção 3). Ver src/lib/webhooks.ts. Idempotente.

create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  url text not null check (url ~ '^https://'),
  secret_enc text not null,
  events text[] not null default '{}',
  scope_type text not null default 'all' check (scope_type in ('bots', 'client', 'all')),
  scope_bot_ids uuid[] not null default '{}',
  scope_client_id uuid references public.clients(id) on delete cascade,
  active boolean not null default true,
  disabled_at timestamptz,
  disabled_reason text,
  -- primeira falha desde a última entrega: 3 dias só de falhas desativa
  failing_since timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists webhooks_agency_idx on public.webhooks (agency_id);
alter table public.webhooks enable row level security; -- interna: só service role
grant all on public.webhooks to service_role;

-- Cada evento por webhook (o id do evento sai do fato: a nova tentativa leva o mesmo id).
create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.webhooks(id) on delete cascade,
  event_id text not null,
  event_type text not null,
  payload_enc text not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status int,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (webhook_id, event_id)
);
create index if not exists webhook_deliveries_due_idx on public.webhook_deliveries (next_attempt_at) where status = 'pending';
alter table public.webhook_deliveries enable row level security;
grant all on public.webhook_deliveries to service_role;

-- Checagem de identidade da Meta (enable_identity_key_check) ligada no número: a partir dela,
-- cada mensagem recebida traz o identity_key_hash do contato (número reciclado ou aparelho novo).
alter table public.whatsapp_channels add column if not exists identity_check_at timestamptz;

notify pgrst, 'reload schema';

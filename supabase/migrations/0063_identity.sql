-- Boavoz · contato identificado no widget (P2, spec "Peça 4"): segredo de identidade, contato
-- com external_id e conversa presa à pessoa e ao contexto. Ver src/lib/identity.ts e
-- src/lib/widget-identity.ts. Idempotente.

-- Segredo de identidade: o servidor do SaaS assina o token (JWT HS256) com ele. Escopo igual ao
-- das chaves de API: um chatbot, um cliente ou todos (Plataforma). O kid vai no cabeçalho do
-- token e só é buscado entre os segredos da agência do chatbot. Mostrado uma vez.
create table if not exists public.identity_secrets (
  id uuid primary key default gen_random_uuid(),
  kid text not null unique check (kid ~ '^idk_[a-z0-9]{16}$'),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  scope_type text not null check (scope_type in ('bot', 'client', 'all')),
  scope_bot_id uuid references public.bots(id) on delete cascade,
  scope_client_id uuid references public.clients(id) on delete cascade,
  secret_enc text not null,
  created_by text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  check (scope_type <> 'bot' or scope_bot_id is not null),
  check (scope_type <> 'client' or scope_client_id is not null)
);
create index if not exists identity_secrets_agency_idx on public.identity_secrets (agency_id);
alter table public.identity_secrets enable row level security; -- interna: só service role
grant all on public.identity_secrets to service_role;

-- Contato identificado: external_id em hash (busca) e selado (vai para as ações e webhooks);
-- display é o que a empresa mandou para personalizar ({"name": "Ruan"}).
alter table public.contacts add column if not exists external_id_hash text;
alter table public.contacts add column if not exists external_id_enc text;
alter table public.contacts add column if not exists display jsonb;
create unique index if not exists contacts_external_idx on public.contacts (bot_id, channel, external_id_hash) where external_id_hash is not null;

-- Conversa presa à identidade: a de nível usuário só volta com um token da mesma pessoa
-- (identity_hash) e do mesmo contexto (context_hash, HMAC do contexto em JSON canônico).
-- context_enc vai só para as ações (nunca para a IA); context_display, para a conversa.
alter table public.conversations add column if not exists identity_hash text;
alter table public.conversations add column if not exists context_hash text;
alter table public.conversations add column if not exists context_enc text;
alter table public.conversations add column if not exists context_source text check (context_source in ('bot', 'token', 'pairing'));
alter table public.conversations add column if not exists context_display text;
create index if not exists conversations_identity_idx on public.conversations (bot_id, identity_hash, last_message_at desc) where identity_hash is not null;

notify pgrst, 'reload schema';

-- Boavoz · chaves da API pública (P1): escopo de bots (lista, um cliente ou todos, inclusive os
-- futuros) e permissões. A chave aparece uma vez; o banco guarda só o hash (sha256) e o início,
-- para reconhecer. Criadas e revogadas no backoffice nos pilotos; a aba Integrações → Chaves de
-- API chega na C pública. Ver src/lib/api-keys.ts e src/lib/api-v1.ts. Idempotente.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  prefix text not null,
  key_hash text not null unique,
  scope_type text not null check (scope_type in ('bots', 'client', 'all')),
  scope_bot_ids uuid[] not null default '{}',
  scope_client_id uuid references public.clients(id) on delete cascade,
  permissions text[] not null default '{}'
    check (permissions <@ array['messages', 'conversations', 'contacts', 'pairing', 'campaigns', 'sources', 'provisioning', 'members']::text[]),
  created_by text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  check (scope_type <> 'bots' or cardinality(scope_bot_ids) > 0),
  check (scope_type <> 'client' or scope_client_id is not null)
);
create index if not exists api_keys_agency_idx on public.api_keys (agency_id);
alter table public.api_keys enable row level security; -- interna: sem policy, só service role
grant all on public.api_keys to service_role;

-- idade informada pela empresa (PUT /v1/contacts/{contact}/age): o texto de origem e a chave que
-- informou (source = 'empresa'). A data de nascimento nunca é guardada.
alter table public.contact_ages add column if not exists origin text;
alter table public.contact_ages add column if not exists api_key_id uuid references public.api_keys(id) on delete set null;

notify pgrst, 'reload schema';

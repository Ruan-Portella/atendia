-- Boavoz · pareamento no WhatsApp e no Instagram (P2, spec "Peça 4"): o SaaS gera um código
-- (POST /v1/pairings), a pessoa manda "Conectar ABC123" (ou abre o link do Instagram com ?ref=)
-- e o contato fica vinculado à conta dela na empresa (external_id) e a um contexto (workspace).
-- Ver src/lib/pairing.ts. Idempotente.

-- Código de uso único, 10 minutos. O código fica só em hash.
create table if not exists public.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'instagram')),
  code_hash text not null,
  external_id_hash text not null,
  external_id_enc text not null,
  context_hash text,
  context_enc text,
  display jsonb,
  expected_phone_hash text,
  api_key_id uuid references public.api_keys(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists pairing_codes_lookup_idx on public.pairing_codes (bot_id, code_hash);
alter table public.pairing_codes enable row level security; -- interna: só service role
grant all on public.pairing_codes to service_role;

-- Vínculo ativo: contato do canal ↔ external_id (+ contexto). Não expira por tempo; cai pela API,
-- por "desconectar" no chat ou quando a identidade do WhatsApp muda (parte 3).
create table if not exists public.contact_links (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'instagram')),
  external_id_hash text not null,
  external_id_enc text not null,
  context_hash text,
  context_enc text,
  display jsonb,
  pairing_id uuid references public.pairing_codes(id) on delete set null,
  linked_at timestamptz not null default now(),
  last_used_at timestamptz,
  unlinked_at timestamptz,
  unlink_reason text,
  identity_key_hash text
);
create unique index if not exists contact_links_active_idx on public.contact_links (contact_id, external_id_hash, coalesce(context_hash, '')) where unlinked_at is null;
create index if not exists contact_links_external_idx on public.contact_links (bot_id, external_id_hash) where unlinked_at is null;
alter table public.contact_links enable row level security;
drop policy if exists contact_links_agency_read on public.contact_links;
create policy contact_links_agency_read on public.contact_links for select to authenticated
  using (bot_id in (select id from public.bots where agency_id = (select public.my_agency_id())));
grant select on public.contact_links to authenticated;
grant all on public.contact_links to service_role;

-- Um contexto ativo por contato (o último pareado ou usado); a troca abre um trecho novo da
-- conversa (a IA só lê o que veio depois de context_since).
alter table public.contacts add column if not exists active_link_id uuid references public.contact_links(id) on delete set null;
alter table public.conversations add column if not exists context_since timestamptz;

-- Idempotency-Key da API (vale 24 h, única por chave de API): a mesma chave devolve a mesma
-- resposta; com outro corpo, 409.
create table if not exists public.idempotency_keys (
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 255),
  request_hash text not null,
  status int,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (api_key_id, key)
);
alter table public.idempotency_keys enable row level security;
grant all on public.idempotency_keys to service_role;

notify pgrst, 'reload schema';

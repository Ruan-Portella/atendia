-- Boavoz · link de conexão do WhatsApp: a agência manda, o cliente conecta o próprio número
-- Idempotente.

-- Guarda só o hash do token (quem lê o banco não consegue montar um link válido).
create table if not exists public.whatsapp_connect_links (
  token_hash text primary key,
  bot_id uuid not null references public.bots(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists whatsapp_connect_links_bot_idx on public.whatsapp_connect_links (bot_id);

-- só a service role (a página pública resolve o link no servidor)
alter table public.whatsapp_connect_links enable row level security;

notify pgrst, 'reload schema';

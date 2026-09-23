-- Boavoz · Instagram Direct (API do Instagram com login do Instagram)
-- Idempotente.

-- Uma conta profissional do Instagram responde por um chatbot. O token do cliente vence em 60 dias
-- e é renovado pelo cron diário (token_expires_at).
create table if not exists public.instagram_channels (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null unique references public.bots(id) on delete cascade,
  ig_user_id text not null unique,  -- id da conta profissional (é o "id" das entradas do webhook)
  username text,
  access_token_enc text,            -- cifrado (lib/secret-box.ts); apagado ao desconectar
  token_expires_at timestamptz,
  disconnected_at timestamptz,
  disconnect_reason text,
  created_at timestamptz not null default now()
);

alter table public.instagram_channels enable row level security;
drop policy if exists instagram_channels_owner on public.instagram_channels;
create policy instagram_channels_owner on public.instagram_channels for select
  using (bot_id in (select id from public.bots where agency_id = public.my_agency_id()));
-- o token nunca sai do servidor
revoke select on public.instagram_channels from anon, authenticated;
grant select (id, bot_id, ig_user_id, username, token_expires_at, disconnected_at, disconnect_reason, created_at)
  on public.instagram_channels to authenticated;

-- quem é o contato numa conversa do Instagram (IGSID: id do usuário visto pela conta do cliente)
alter table public.conversations add column if not exists ig_id text;
create index if not exists conversations_ig_idx on public.conversations (bot_id, ig_id, last_message_at desc) where ig_id is not null;

-- o link de conexão serve para WhatsApp ou Instagram (a tabela nasceu só para o WhatsApp)
alter table public.whatsapp_connect_links add column if not exists channel text not null default 'whatsapp';

notify pgrst, 'reload schema';

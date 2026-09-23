-- Boavoz · WhatsApp (Cloud API da Meta): número ligado a um chatbot + conversas por contato
-- Idempotente.

-- Um número do WhatsApp responde por um chatbot. O token ainda é o do .env (WHATSAPP_TOKEN,
-- número de teste); o token por cliente chega com o cadastro incorporado (Embedded Signup).
create table if not exists public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  phone_number_id text not null unique,
  waba_id text,
  display_phone text,
  verified_name text,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_channels_bot_idx on public.whatsapp_channels (bot_id);

alter table public.whatsapp_channels enable row level security;
drop policy if exists whatsapp_channels_owner on public.whatsapp_channels;
create policy whatsapp_channels_owner on public.whatsapp_channels for select
  using (bot_id in (select id from public.bots where agency_id = public.my_agency_id()));

-- quem é o contato numa conversa do WhatsApp (o número, no formato que a Meta manda)
alter table public.conversations add column if not exists wa_id text;
create index if not exists conversations_wa_idx on public.conversations (bot_id, wa_id, last_message_at desc) where wa_id is not null;

-- A Meta reentrega o webhook quando não recebe 200 a tempo: cada mensagem é tratada uma vez só.
create table if not exists public.whatsapp_inbound (
  message_id text primary key,
  created_at timestamptz not null default now()
);
alter table public.whatsapp_inbound enable row level security;

notify pgrst, 'reload schema';

-- BoaVoz · E1 (Lojas de Instagram), parte 3a: perguntas prontas do direct e links ig.me com origem.
-- Idempotente.
--
-- bots.ig_ice_breakers: até 4 perguntas que aparecem quando a pessoa abre o direct pela primeira
-- vez (ice breakers da Meta, gravados em messenger_profile; não aparecem no computador). O toque
-- chega como mensagem e a IA responde. synced_at e error: a última gravação na Meta.
-- instagram_ref_links: os links ig.me/m/<conta>?ref=<origem> da loja (bio, QR impresso, anúncio),
-- com o nome que aparece no painel e uma nota opcional para a IA. A origem da conversa fica em
-- conversations.origin_ref/origin_label; quando a pessoa abre o link sem escrever (numa conversa
-- antiga), a origem espera no contato (origin_* em contacts) até a próxima mensagem.

alter table public.bots add column if not exists ig_ice_breakers jsonb not null default '[]'::jsonb;
alter table public.bots drop constraint if exists bots_ig_ice_breakers_check;
alter table public.bots add constraint bots_ig_ice_breakers_check check (jsonb_typeof(ig_ice_breakers) = 'array' and jsonb_array_length(ig_ice_breakers) <= 4);
alter table public.bots
  add column if not exists ig_ice_breakers_synced_at timestamptz,
  add column if not exists ig_ice_breakers_error text;

create table if not exists public.instagram_ref_links (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  ref text not null check (ref ~ '^[a-z0-9_-]{2,40}$'),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (bot_id, ref)
);
alter table public.instagram_ref_links enable row level security;
revoke all on public.instagram_ref_links from anon, authenticated;
grant all on public.instagram_ref_links to service_role;

alter table public.conversations
  add column if not exists origin_ref text,
  add column if not exists origin_label text;
alter table public.contacts
  add column if not exists origin_ref text,
  add column if not exists origin_label text,
  add column if not exists origin_at timestamptz;

notify pgrst, 'reload schema';

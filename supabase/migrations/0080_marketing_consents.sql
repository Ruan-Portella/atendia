-- Boavoz · consentimento de marketing com prova (leva B3, parte 1).
--
-- marketing_consents: cada sim ou não à oferta de novidades, com a origem, o texto mostrado (e a
-- versão), a data e a revogação. É a prova para a LGPD: fica pelo hash do número (como a lista de
-- supressão) e sem FK para agência, cliente ou bot, para sobreviver à exclusão do contato e do
-- chatbot; o contact_id só ajuda o painel e vira null quando o contato é apagado. Guardada 5 anos
-- depois da revogação (ou da recusa). No MVP, só WhatsApp (as campanhas são só por lá).
-- bots.marketing_optin_offer: o chatbot oferece novidades no WhatsApp (desligado por padrão).
-- contacts.marketing_offer_at: a oferta já foi feita a este contato (uma vez por contato).
-- Idempotente.

create table if not exists public.marketing_consents (
  id bigserial primary key,
  agency_id uuid,
  client_id uuid,
  bot_id uuid,
  waba_id text,
  contact_id uuid references public.contacts(id) on delete set null,
  channel text not null check (channel in ('whatsapp')),
  -- como na supressão: waba:<id> ou bot:<id>
  scope text not null,
  contact_hash text not null,
  -- true: aceitou; false: recusou a oferta (não oferece de novo)
  granted boolean not null,
  source text not null check (source in ('chat', 'panel', 'import', 'api')),
  text text not null,
  text_version text not null,
  -- quem registrou pelo painel ou pela importação (e-mail); no chat, o próprio contato
  collected_by text,
  collected_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_source text,
  created_at timestamptz not null default now()
);
create index if not exists marketing_consents_contact_idx on public.marketing_consents (scope, contact_hash, channel, collected_at desc);
create index if not exists marketing_consents_contact_id_idx on public.marketing_consents (contact_id);
create index if not exists marketing_consents_bot_idx on public.marketing_consents (bot_id, collected_at);
alter table public.marketing_consents enable row level security;
revoke all on public.marketing_consents from anon, authenticated;
grant all on public.marketing_consents to service_role;
grant usage, select on sequence public.marketing_consents_id_seq to service_role;

alter table public.bots add column if not exists marketing_optin_offer boolean not null default false;
alter table public.contacts add column if not exists marketing_offer_at timestamptz;

notify pgrst, 'reload schema';

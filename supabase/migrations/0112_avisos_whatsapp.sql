-- Boavoz · avisos e assistente no WhatsApp (parte 1, 19/10/2026).
--
-- A BoaVoz atende pelo próprio produto: um chatbot da plataforma (platform_flags.assistant_bot_id),
-- com número de WhatsApp próprio, manda os avisos da conta para a equipe do painel e responde sobre
-- o app. Cada pessoa da equipe põe o número dela no painel (team_whatsapp) e confirma pelo botão do
-- modelo que chega no WhatsApp: só o "Confirmar" liga os avisos ("Não fui eu" bloqueia o número).
-- A área do cliente nunca recebe (mostraria a marca BoaVoz no lugar da marca da agência).
-- Idempotente.

alter table public.platform_flags add column if not exists assistant_bot_id uuid references public.bots(id) on delete set null;

create table if not exists public.team_whatsapp (
  member_id uuid primary key references public.agency_members(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- o número, cifrado (chave da plataforma: é da equipe da agência, não do contato de um cliente)
  phone_enc text not null,
  phone_hash text not null,
  status text not null check (status in ('pending', 'confirmed', 'refused')),
  -- o aceite: a versão do texto mostrado no painel, o pedido e a confirmação pelo botão
  consent_version text not null,
  requested_at timestamptz not null default now(),
  -- o pedido em aberto (vai no botão): o toque num modelo de um pedido antigo não vale
  nonce text not null,
  confirmed_at timestamptz,
  refused_at timestamptz,
  -- quais avisos a pessoa quer (parte 3); vazio = os de sempre
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
-- um número recebe os avisos de uma pessoa só
create unique index if not exists team_whatsapp_phone_idx on public.team_whatsapp (phone_hash) where status in ('pending', 'confirmed');
create index if not exists team_whatsapp_agency_idx on public.team_whatsapp (agency_id) where status = 'confirmed';
alter table public.team_whatsapp enable row level security;
revoke all on public.team_whatsapp from anon, authenticated;
grant all on public.team_whatsapp to service_role;

-- "Agora não" no cartão do topo do painel (o campo continua em Meu perfil)
alter table public.agency_members add column if not exists whatsapp_card_dismissed_at timestamptz;

notify pgrst, 'reload schema';

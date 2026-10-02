-- Boavoz · regra única de estado da conversa (L1): quem responde (IA, equipe ou ninguém) e se o
-- BoaVoz pode enviar, por degraus (ver src/lib/conversation-mode.ts). Calculada na hora a partir
-- das fontes abaixo (sem coluna "modo" gravada). Idempotente.

-- Medidas da BoaVoz e da Meta. feature: channel (bloqueia o canal), regulados (infração de bebida
-- ou remédio na Meta), restricao (restrição da Meta a mensagens iniciadas pela empresa), outro
-- (só registro: outra infração, desligamento agendado). Ativa enquanto lifted_at é null.
create table if not exists public.enforcement_actions (
  id bigserial primary key,
  source text not null check (source in ('boavoz', 'meta_order', 'meta_violation', 'meta_restriction')),
  feature text not null default 'channel' check (feature in ('channel', 'regulados', 'restricao', 'outro')),
  channel text not null default 'all' check (channel in ('whatsapp', 'instagram', 'widget', 'all')),
  agency_id uuid references public.agencies(id) on delete cascade,
  bot_id uuid references public.bots(id) on delete cascade,
  waba_id text,
  reason text,
  detail jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by text
);
create index if not exists enforcement_active_agency_idx on public.enforcement_actions (agency_id) where lifted_at is null;
create index if not exists enforcement_active_bot_idx on public.enforcement_actions (bot_id) where lifted_at is null;
create index if not exists enforcement_active_waba_idx on public.enforcement_actions (waba_id) where lifted_at is null;
alter table public.enforcement_actions enable row level security; -- interna: sem policy
grant all on public.enforcement_actions to service_role;
grant usage, select on sequence public.enforcement_actions_id_seq to service_role;

-- Pausa do bot pelo dono (botão de emergência "Pausar no BoaVoz"): a IA para, a equipe responde.
alter table public.bots add column if not exists paused_at timestamptz;
alter table public.bots add column if not exists paused_by text;          -- panel | api
alter table public.bots add column if not exists pause_reason text;
alter table public.bots add column if not exists pause_notify boolean not null default false; -- avisar o contato, uma vez por episódio

-- Desligamento geral do WhatsApp (plano B da Meta): nada entra nem sai pela Cloud API.
alter table public.platform_flags add column if not exists whatsapp_disabled_at timestamptz;
alter table public.platform_flags add column if not exists whatsapp_disabled_reason text;

-- Aviso ao contato "uma vez por episódio": um campo só, com o motivo; zera quando o estado muda.
alter table public.conversations add column if not exists unavailable_notice_at timestamptz;
alter table public.conversations add column if not exists unavailable_notice_reason text;
update public.conversations
  set unavailable_notice_at = human_only_notice_at, unavailable_notice_reason = 'so_humano'
  where human_only_notice_at is not null and unavailable_notice_at is null;

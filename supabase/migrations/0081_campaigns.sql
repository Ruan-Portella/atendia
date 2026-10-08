-- Boavoz · motor de campanhas e lembretes (leva B3, parte 3a; spec Peça 7 "Envios ativos").
--
-- campaigns: campanha de marketing ou lembrete de utilidade, só WhatsApp no MVP. Pausar é mudar o
-- status. campaign_sends: a agenda dos envios (uma linha por contato, ou por linha da planilha nos
-- lembretes), fora da fila de entrada: um tique por minuto reserva um lote com FOR UPDATE SKIP
-- LOCKED (campaign_claim), limitado ao saldo do portfólio (campaign_recent_recipients) e à vazão
-- do número. Cada envio leva o id da linha em biz_opaque_callback_data, e o status da Meta
-- concilia. Sem resposta da Meta, a linha fica "sending" e vira "uncertain" em 5 minutos: nunca é
-- reenviada sozinha. Telefone e variáveis vão cifrados com a chave do cliente; variáveis apagadas
-- 30 dias depois do envio. clients.timezone: o fuso em que a agenda e o aviso de 20h às 8h são lidos.
-- Idempotente.

alter table public.clients add column if not exists timezone text not null default 'America/Sao_Paulo';

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  bot_id uuid not null references public.bots(id) on delete cascade,
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  kind text not null check (kind in ('marketing', 'utility_reminder')),
  name text not null check (char_length(name) between 1 and 120),
  template_name text not null,
  template_language text not null default 'pt_BR',
  -- categoria do modelo quando a campanha foi montada (MARKETING ou UTILITY); conferida de novo no envio
  template_category text not null,
  -- oferece bebida ou remédio: só vai para quem confirmou 18+
  regulated boolean not null default false,
  audience jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'paused', 'finished', 'canceled')),
  pause_reason text,
  estimated_contacts int,
  estimated_cost_cents int,
  totals jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists campaigns_bot_idx on public.campaigns (bot_id, created_at desc);
create index if not exists campaigns_active_idx on public.campaigns (status, scheduled_at) where status in ('scheduled', 'sending');
alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;
grant all on public.campaigns to service_role;

create table if not exists public.campaign_sends (
  id bigserial primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  -- marketing: o contato; lembrete: a linha da planilha. Cada um sai uma vez só
  dedupe_key text not null,
  phone_enc text,
  -- hash do telefone canônico (contatos únicos nas últimas 24 h, por portfólio)
  phone_hash text not null,
  send_at timestamptz not null default now(),
  claimed_at timestamptz,
  variables_enc text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'uncertain', 'skipped_no_consent', 'skipped_suppressed', 'skipped_no_age', 'skipped_contact_deleted', 'opted_out')),
  channel_msg_hash text,
  error_code text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (campaign_id, dedupe_key)
);
create index if not exists campaign_sends_due_idx on public.campaign_sends (campaign_id, send_at) where status = 'queued';
create index if not exists campaign_sends_sending_idx on public.campaign_sends (claimed_at) where status = 'sending';
create index if not exists campaign_sends_recent_idx on public.campaign_sends (sent_at) where sent_at is not null;
create index if not exists campaign_sends_contact_idx on public.campaign_sends (contact_id);
alter table public.campaign_sends enable row level security;
revoke all on public.campaign_sends from anon, authenticated;
grant all on public.campaign_sends to service_role;
grant usage, select on sequence public.campaign_sends_id_seq to service_role;

-- reserva um lote de uma campanha (só as que estão enviando): ninguém pega a mesma linha duas vezes
create or replace function public.campaign_claim(p_campaign uuid, p_limit int, p_now timestamptz default now())
returns setof public.campaign_sends
language sql
security definer
set search_path = public
as $$
  update public.campaign_sends s
  set status = 'sending', claimed_at = p_now, updated_at = p_now
  where s.id in (
    select s2.id
    from public.campaign_sends s2
    join public.campaigns c on c.id = s2.campaign_id
    where s2.campaign_id = p_campaign and s2.status = 'queued' and s2.send_at <= p_now and c.status = 'sending'
    order by s2.send_at, s2.id
    limit greatest(p_limit, 0)
    for update of s2 skip locked
  )
  returning s.*
$$;

-- contatos únicos que receberam (ou estão recebendo) campanha ou lembrete do portfólio nas últimas 24 h
create or replace function public.campaign_recent_recipients(p_bot_ids uuid[], p_since timestamptz)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct s.phone_hash)::int
  from public.campaign_sends s
  join public.campaigns c on c.id = s.campaign_id
  where c.bot_id = any (p_bot_ids)
    and s.status in ('sending', 'sent', 'delivered', 'read', 'uncertain')
    and coalesce(s.sent_at, s.claimed_at) > p_since
$$;

-- quantos envios em cada status (relatório e fim da campanha)
create or replace function public.campaign_totals(p_campaign uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
  from (select status, count(*)::int as n from public.campaign_sends where campaign_id = p_campaign group by status) t
$$;

revoke all on function public.campaign_totals(uuid) from public, anon, authenticated;
grant execute on function public.campaign_totals(uuid) to service_role;
revoke all on function public.campaign_claim(uuid, int, timestamptz) from public, anon, authenticated;
grant execute on function public.campaign_claim(uuid, int, timestamptz) to service_role;
revoke all on function public.campaign_recent_recipients(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.campaign_recent_recipients(uuid[], timestamptz) to service_role;

notify pgrst, 'reload schema';

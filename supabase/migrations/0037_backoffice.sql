-- Boavoz · backoffice da plataforma (/admin): registro de acesso, histórico das avaliações e
-- números agregados no banco (a página não puxa milhares de linhas).
-- Idempotente. Tudo interno: RLS ligada, sem policy, só a service role lê e escreve/executa.

-- Quem abriu o quê no backoffice (Marco Civil: registro de acesso a aplicação; e quem viu dado
-- de cliente). Só o caminho, nunca o conteúdo.
create table if not exists public.admin_access_log (
  id bigserial primary key,
  user_id uuid,
  email text not null,
  path text not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_access_log_created_idx on public.admin_access_log (created_at);
alter table public.admin_access_log enable row level security;
grant all on public.admin_access_log to service_role;
grant usage, select on sequence public.admin_access_log_id_seq to service_role;

-- Rodadas do conjunto fixo de casos (/api/eval), para comparar antes e depois de uma mudança.
create table if not exists public.eval_runs (
  id bigserial primary key,
  bot_id uuid references public.bots(id) on delete set null,
  bot_name text,
  case_file text not null,                 -- casos | bar | …
  categories text[] not null default '{}', -- vazio: todas
  model text not null,
  effort text,
  classifier text,
  runs int not null,
  passed int not null default 0,
  total int not null default 0,
  must_ok boolean not null default false,
  cost_usd_per_answer numeric(12,6),
  cache_pct int,
  skipped int not null default 0,
  report text not null default '',
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists eval_runs_created_idx on public.eval_runs (created_at desc);
alter table public.eval_runs enable row level security;
grant all on public.eval_runs to service_role;
grant usage, select on sequence public.eval_runs_id_seq to service_role;

-- Índices para as contas por dia (mensagens e conversas de toda a plataforma).
create index if not exists messages_created_idx on public.messages (created_at);
create index if not exists conversations_started_idx on public.conversations (started_at);

-- Atividade por dia (horário de Brasília), sem os bots de demonstração da landing.
create or replace function public.admin_daily_activity(p_days int)
returns table (day date, conversations bigint, contact_messages bigint, bot_messages bigint, team_messages bigint)
language sql stable
set search_path = public
as $$
  with days as (
    select generate_series(
      (now() at time zone 'America/Sao_Paulo')::date - (p_days - 1),
      (now() at time zone 'America/Sao_Paulo')::date,
      interval '1 day'
    )::date as day
  ),
  m as (
    select (m.created_at at time zone 'America/Sao_Paulo')::date as day, m.role, count(*) as n
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.bots b on b.id = c.bot_id and not b.is_demo
    where m.created_at >= now() - make_interval(days => p_days + 1)
    group by 1, 2
  ),
  c as (
    select (c.started_at at time zone 'America/Sao_Paulo')::date as day, count(*) as n
    from public.conversations c
    join public.bots b on b.id = c.bot_id and not b.is_demo
    where c.started_at >= now() - make_interval(days => p_days + 1)
    group by 1
  )
  select d.day,
    coalesce((select sum(c.n) from c where c.day = d.day), 0)::bigint,
    coalesce((select sum(m.n) from m where m.day = d.day and m.role = 'user'), 0)::bigint,
    coalesce((select sum(m.n) from m where m.day = d.day and m.role = 'assistant'), 0)::bigint,
    coalesce((select sum(m.n) from m where m.day = d.day and m.role = 'agent'), 0)::bigint
  from days d
  order by d.day;
$$;

-- Conversas por canal nos últimos N dias (sem demonstração).
create or replace function public.admin_channel_split(p_days int)
returns table (channel text, conversations bigint)
language sql stable
set search_path = public
as $$
  select coalesce(c.channel, 'widget'), count(*)
  from public.conversations c
  join public.bots b on b.id = c.bot_id and not b.is_demo
  where c.started_at >= now() - make_interval(days => p_days)
  group by 1
  order by 2 desc;
$$;

-- Uma linha por agência: bots, canais, conversas do mês (cota), custo de IA do mês, última atividade.
create or replace function public.admin_agency_stats(p_period text, p_month_start timestamptz)
returns table (agency_id uuid, bots bigint, live_bots bigint, whatsapp bigint, instagram bigint, conversations_month int, ai_cost_month numeric, last_activity timestamptz)
language sql stable
set search_path = public
as $$
  select a.id,
    (select count(*) from public.bots b where b.agency_id = a.id and not b.is_demo),
    (select count(*) from public.bots b where b.agency_id = a.id and not b.is_demo and b.status = 'live'),
    (select count(*) from public.whatsapp_channels w join public.bots b on b.id = w.bot_id where b.agency_id = a.id and w.disconnected_at is null),
    (select count(*) from public.instagram_channels i join public.bots b on b.id = i.bot_id where b.agency_id = a.id and i.disconnected_at is null),
    coalesce((select u.conversations from public.usage u where u.agency_id = a.id and u.period = p_period), 0),
    coalesce((select sum(x.cost_usd) from public.ai_usage x where x.agency_id = a.id and x.created_at >= p_month_start), 0),
    (select max(c.last_message_at) from public.conversations c join public.bots b on b.id = c.bot_id where b.agency_id = a.id)
  from public.agencies a
  where a.owner_id is not null;
$$;

-- Custo de IA agrupado (tipo, modelo, canal, agência) num intervalo. O detalhe fica 90 dias.
create or replace function public.admin_ai_costs(p_since timestamptz, p_until timestamptz)
returns table (kind text, model text, channel text, agency_id uuid, calls bigint, input_tokens bigint, cached_input_tokens bigint, output_tokens bigint, audio_seconds numeric, cost_usd numeric, unpriced bigint)
language sql stable
set search_path = public
as $$
  select x.kind, x.model, x.channel, x.agency_id, count(*),
    coalesce(sum(x.input_tokens), 0), coalesce(sum(x.cached_input_tokens), 0), coalesce(sum(x.output_tokens), 0),
    coalesce(sum(x.audio_seconds), 0), coalesce(sum(x.cost_usd), 0), count(*) filter (where x.cost_usd is null)
  from public.ai_usage x
  where x.created_at >= p_since and x.created_at < p_until
  group by 1, 2, 3, 4;
$$;

-- Custo de IA por dia (horário de Brasília) no intervalo.
create or replace function public.admin_ai_daily(p_since timestamptz, p_until timestamptz)
returns table (day date, cost_usd numeric, calls bigint)
language sql stable
set search_path = public
as $$
  select (x.created_at at time zone 'America/Sao_Paulo')::date, coalesce(sum(x.cost_usd), 0), count(*)
  from public.ai_usage x
  where x.created_at >= p_since and x.created_at < p_until
  group by 1
  order by 1;
$$;

-- Só o servidor (service role) executa: nada de anon/authenticated pela API do Supabase.
revoke all on function public.admin_daily_activity(int) from public, anon, authenticated;
revoke all on function public.admin_channel_split(int) from public, anon, authenticated;
revoke all on function public.admin_agency_stats(text, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_ai_costs(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_ai_daily(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_daily_activity(int) to service_role;
grant execute on function public.admin_channel_split(int) to service_role;
grant execute on function public.admin_agency_stats(text, timestamptz) to service_role;
grant execute on function public.admin_ai_costs(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_ai_daily(timestamptz, timestamptz) to service_role;

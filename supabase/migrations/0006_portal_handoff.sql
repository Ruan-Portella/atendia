-- Atendia · portal do cliente final, relatório mensal e atendimento humano
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Portal do cliente (link somente leitura) e relatório mensal por e-mail
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists portal_token text unique,          -- null = portal desligado
  add column if not exists report_email text,                  -- quem recebe o relatório do mês
  add column if not exists report_last_period text;            -- último mês enviado ('2026-08')

-- ---------------------------------------------------------------------------
-- Atendimento humano: o visitante pede atendente, a agência assume e responde pelo painel.
-- messages.role ganha o valor 'agent' (mensagem escrita por uma pessoa da agência).
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists handoff_requested_at timestamptz,   -- visitante pediu para falar com alguém
  add column if not exists takeover_at timestamptz,            -- alguém da agência assumiu (o bot pausa)
  add column if not exists handled_at timestamptz;             -- atendimento encerrado
create index if not exists conversations_handoff_idx on public.conversations(bot_id, handoff_requested_at desc) where handoff_requested_at is not null and handled_at is null;

-- ---------------------------------------------------------------------------
-- Números de um conjunto de chatbots num intervalo (relatório e portal).
-- Security invoker: no painel respeita a RLS; o portal chama com a service role já filtrando
-- pelos chatbots do cliente do link.
-- ---------------------------------------------------------------------------
create or replace function public.bots_summary(p_bot_ids uuid[], p_from timestamptz, p_to timestamptz)
returns table (conversations int, needs_human int, leads int, visitor_messages int)
language sql stable security invoker set search_path = public as $$
  select
    (select count(*) from public.conversations c where c.bot_id = any(p_bot_ids) and c.started_at >= p_from and c.started_at < p_to)::int,
    (select count(*) from public.conversations c where c.bot_id = any(p_bot_ids) and c.started_at >= p_from and c.started_at < p_to and c.needs_human)::int,
    (select count(*) from public.leads l where l.bot_id = any(p_bot_ids) and l.created_at >= p_from and l.created_at < p_to)::int,
    (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id
      where c.bot_id = any(p_bot_ids) and m.role = 'user' and m.created_at >= p_from and m.created_at < p_to)::int;
$$;

/** Conversas e leads por dia (fuso de São Paulo), para o gráfico do relatório. */
create or replace function public.bots_daily(p_bot_ids uuid[], p_from timestamptz, p_to timestamptz)
returns table (day date, conversations int, leads int)
language sql stable security invoker set search_path = public as $$
  with days as (
    select generate_series((p_from at time zone 'America/Sao_Paulo')::date, ((p_to - interval '1 second') at time zone 'America/Sao_Paulo')::date, interval '1 day')::date as day
  ),
  c as (
    select (started_at at time zone 'America/Sao_Paulo')::date as day, count(*) as n
    from public.conversations where bot_id = any(p_bot_ids) and started_at >= p_from and started_at < p_to group by 1
  ),
  l as (
    select (created_at at time zone 'America/Sao_Paulo')::date as day, count(*) as n
    from public.leads where bot_id = any(p_bot_ids) and created_at >= p_from and created_at < p_to group by 1
  )
  select d.day, coalesce(c.n, 0)::int, coalesce(l.n, 0)::int
  from days d left join c on c.day = d.day left join l on l.day = d.day
  order by d.day;
$$;

notify pgrst, 'reload schema';

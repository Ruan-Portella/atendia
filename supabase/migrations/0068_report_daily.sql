-- Leva S, parte 2a: totais diários (report_daily), para os relatórios não dependerem das conversas,
-- que a retenção apaga. Uma linha por dia (fuso de São Paulo), chatbot e canal, sem conteúdo de
-- conversa nem dado do contato; guardada enquanto a conta existir. O job diário recalcula os 2
-- últimos dias fechados antes da retenção (e preenche o histórico na primeira vez); a retenção não
-- apaga nada depois do último dia agregado (platform_flags.report_daily_through).
-- Quem lê soma o agregado (até o último dia agregado) com a contagem ao vivo dos dias seguintes:
-- bot_stats, bots_summary, bots_daily, admin_daily_activity e admin_channel_split continuam com a
-- mesma assinatura.

create table if not exists public.report_daily (
  day date not null,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- ids soltos: o total do dia fica mesmo se o chatbot ou o cliente sair
  client_id uuid,
  bot_id uuid not null,
  channel text not null,
  conversations int not null default 0,
  needs_human int not null default 0,
  handoffs int not null default 0,
  contact_messages int not null default 0,
  bot_messages int not null default 0,
  team_messages int not null default 0,
  atendimentos int not null default 0,
  leads int not null default 0,
  unanswered int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, bot_id, channel)
);
create index if not exists report_daily_bot_idx on public.report_daily (bot_id, day);
create index if not exists report_daily_agency_idx on public.report_daily (agency_id, day);

alter table public.report_daily enable row level security;
drop policy if exists report_daily_agency_read on public.report_daily;
create policy report_daily_agency_read on public.report_daily for select to authenticated
  using (agency_id = (select public.my_agency_id()));
revoke all on public.report_daily from anon, authenticated;
grant select on public.report_daily to authenticated;
grant all on public.report_daily to service_role;

-- último dia (São Paulo) já agregado; nulo = ainda não agregou nada (tudo é contado ao vivo)
alter table public.platform_flags add column if not exists report_daily_through date;

-- pergunta sem resposta ganha a conversa (o canal entra nos totais do dia)
alter table public.unanswered add column if not exists conversation_id uuid references public.conversations(id) on delete set null;

/** O último dia agregado (platform_flags é interna; o painel lê só isto). */
create or replace function public.report_daily_through()
returns date
language sql stable security definer
set search_path = public
as $$
  select report_daily_through from public.platform_flags where id = 1;
$$;
revoke all on function public.report_daily_through() from public, anon;
grant execute on function public.report_daily_through() to authenticated, service_role;

/** Recalcula do zero os dias [p_from, p_to] (São Paulo). Só o job (service role). */
create or replace function public.report_daily_refresh(p_from date, p_to date)
returns int
language plpgsql
set search_path = public
as $$
declare
  lo timestamptz := (p_from::timestamp at time zone 'America/Sao_Paulo');
  hi timestamptz := ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo');
  n int;
begin
  delete from public.report_daily where day between p_from and p_to;
  insert into public.report_daily (day, agency_id, client_id, bot_id, channel, conversations, needs_human, handoffs, contact_messages, bot_messages, team_messages, atendimentos, leads, unanswered, updated_at)
  select x.day, b.agency_id, b.client_id, x.bot_id, x.channel,
    sum(x.conversations), sum(x.needs_human), sum(x.handoffs), sum(x.contact_messages), sum(x.bot_messages), sum(x.team_messages), sum(x.atendimentos), sum(x.leads), sum(x.unanswered), now()
  from (
    select (c.started_at at time zone 'America/Sao_Paulo')::date as day, c.bot_id, coalesce(c.channel, 'widget') as channel,
      1 as conversations, coalesce(c.needs_human, false)::int as needs_human, (c.handoff_requested_at is not null)::int as handoffs,
      0 as contact_messages, 0 as bot_messages, 0 as team_messages, 0 as atendimentos, 0 as leads, 0 as unanswered
    from public.conversations c
    where c.started_at >= lo and c.started_at < hi
    union all
    select (m.created_at at time zone 'America/Sao_Paulo')::date, c.bot_id, coalesce(c.channel, 'widget'),
      0, 0, 0, (m.role = 'user')::int, (m.role = 'assistant')::int, (m.role = 'agent')::int, 0, 0, 0
    from public.messages m join public.conversations c on c.id = m.conversation_id
    where m.created_at >= lo and m.created_at < hi
    union all
    select (a.started_at at time zone 'America/Sao_Paulo')::date, a.bot_id, a.channel,
      0, 0, 0, 0, 0, 0, 1, 0, 0
    from public.atendimentos a
    where a.bot_id is not null and a.started_at >= lo and a.started_at < hi
    union all
    select (l.created_at at time zone 'America/Sao_Paulo')::date, l.bot_id, coalesce(c.channel, 'widget'),
      0, 0, 0, 0, 0, 0, 0, 1, 0
    from public.leads l left join public.conversations c on c.id = l.conversation_id
    where l.created_at >= lo and l.created_at < hi
    union all
    select (u.created_at at time zone 'America/Sao_Paulo')::date, u.bot_id, coalesce(c.channel, 'widget'),
      0, 0, 0, 0, 0, 0, 0, 0, 1
    from public.unanswered u left join public.conversations c on c.id = u.conversation_id
    where u.created_at >= lo and u.created_at < hi
  ) x
  join public.bots b on b.id = x.bot_id
  group by x.day, b.agency_id, b.client_id, x.bot_id, x.channel;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.report_daily_refresh(date, date) from public, anon, authenticated;
grant execute on function public.report_daily_refresh(date, date) to service_role;

-- ---------------------------------------------------------------------------
-- Leitura: agregado até o último dia agregado + ao vivo depois dele
-- ---------------------------------------------------------------------------

-- a janela começa à meia-noite (São Paulo) do dia de p_since: o agregado é por dia inteiro
create or replace function public.bot_stats(p_since timestamptz)
returns table (bot_id uuid, conversations int, needs_human int, leads int)
language sql stable security invoker set search_path = public as $$
  with e as (
    select t.through, t.first_day,
      greatest((t.first_day::timestamp at time zone 'America/Sao_Paulo'), ((t.through + 1)::timestamp at time zone 'America/Sao_Paulo')) as live_from
    from (select coalesce(public.report_daily_through(), date '1900-01-01') as through, (p_since at time zone 'America/Sao_Paulo')::date as first_day) t
  ),
  agg as (
    select r.bot_id, sum(r.conversations) as conv, sum(r.needs_human) as human, sum(r.leads) as leads
    from public.report_daily r, e
    where r.day >= e.first_day and r.day <= e.through
    group by r.bot_id
  ),
  c as (
    select c.bot_id, count(*) as total, count(*) filter (where c.needs_human) as human
    from public.conversations c, e where c.started_at >= e.live_from group by c.bot_id
  ),
  l as (
    select l.bot_id, count(*) as total from public.leads l, e where l.created_at >= e.live_from group by l.bot_id
  )
  select b.id,
    (coalesce(agg.conv, 0) + coalesce(c.total, 0))::int,
    (coalesce(agg.human, 0) + coalesce(c.human, 0))::int,
    (coalesce(agg.leads, 0) + coalesce(l.total, 0))::int
  from public.bots b
  left join agg on agg.bot_id = b.id
  left join c on c.bot_id = b.id
  left join l on l.bot_id = b.id;
$$;

create or replace function public.bots_summary(p_bot_ids uuid[], p_from timestamptz, p_to timestamptz)
returns table (conversations int, needs_human int, leads int, visitor_messages int)
language sql stable security invoker set search_path = public as $$
  with e as (
    select t.through, greatest(p_from, ((t.through + 1)::timestamp at time zone 'America/Sao_Paulo')) as live_from
    from (select coalesce(public.report_daily_through(), date '1900-01-01') as through) t
  ),
  agg as (
    select coalesce(sum(r.conversations), 0) as conv, coalesce(sum(r.needs_human), 0) as human, coalesce(sum(r.leads), 0) as leads, coalesce(sum(r.contact_messages), 0) as msgs
    from public.report_daily r, e
    where r.bot_id = any(p_bot_ids)
      and r.day >= (p_from at time zone 'America/Sao_Paulo')::date
      and r.day < (p_to at time zone 'America/Sao_Paulo')::date
      and r.day <= e.through
  )
  select
    (agg.conv + (select count(*) from public.conversations c, e where c.bot_id = any(p_bot_ids) and c.started_at >= e.live_from and c.started_at < p_to))::int,
    (agg.human + (select count(*) from public.conversations c, e where c.bot_id = any(p_bot_ids) and c.started_at >= e.live_from and c.started_at < p_to and c.needs_human))::int,
    (agg.leads + (select count(*) from public.leads l, e where l.bot_id = any(p_bot_ids) and l.created_at >= e.live_from and l.created_at < p_to))::int,
    (agg.msgs + (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id, e
      where c.bot_id = any(p_bot_ids) and m.role = 'user' and m.created_at >= e.live_from and m.created_at < p_to))::int
  from agg;
$$;

/** Conversas e leads por dia (fuso de São Paulo), para o gráfico do relatório. */
create or replace function public.bots_daily(p_bot_ids uuid[], p_from timestamptz, p_to timestamptz)
returns table (day date, conversations int, leads int)
language sql stable security invoker set search_path = public as $$
  with e as (
    select t.through, greatest(p_from, ((t.through + 1)::timestamp at time zone 'America/Sao_Paulo')) as live_from
    from (select coalesce(public.report_daily_through(), date '1900-01-01') as through) t
  ),
  days as (
    select generate_series((p_from at time zone 'America/Sao_Paulo')::date, ((p_to - interval '1 second') at time zone 'America/Sao_Paulo')::date, interval '1 day')::date as day
  ),
  agg as (
    select r.day, sum(r.conversations) as conv, sum(r.leads) as leads
    from public.report_daily r, e
    where r.bot_id = any(p_bot_ids) and r.day <= e.through
      and r.day >= (p_from at time zone 'America/Sao_Paulo')::date and r.day < (p_to at time zone 'America/Sao_Paulo')::date
    group by r.day
  ),
  c as (
    select (c.started_at at time zone 'America/Sao_Paulo')::date as day, count(*) as n
    from public.conversations c, e where c.bot_id = any(p_bot_ids) and c.started_at >= e.live_from and c.started_at < p_to group by 1
  ),
  l as (
    select (l.created_at at time zone 'America/Sao_Paulo')::date as day, count(*) as n
    from public.leads l, e where l.bot_id = any(p_bot_ids) and l.created_at >= e.live_from and l.created_at < p_to group by 1
  )
  select d.day, (coalesce(agg.conv, 0) + coalesce(c.n, 0))::int, (coalesce(agg.leads, 0) + coalesce(l.n, 0))::int
  from days d left join agg on agg.day = d.day left join c on c.day = d.day left join l on l.day = d.day
  order by d.day;
$$;

create or replace function public.admin_daily_activity(p_days int)
returns table (day date, conversations bigint, contact_messages bigint, bot_messages bigint, team_messages bigint)
language sql stable
set search_path = public
as $$
  with e as (
    select t.through, ((t.through + 1)::timestamp at time zone 'America/Sao_Paulo') as live_from
    from (select coalesce(public.report_daily_through(), date '1900-01-01') as through) t
  ),
  days as (
    select generate_series(
      (now() at time zone 'America/Sao_Paulo')::date - (p_days - 1),
      (now() at time zone 'America/Sao_Paulo')::date,
      interval '1 day'
    )::date as day
  ),
  agg as (
    select r.day, sum(r.conversations) as conv, sum(r.contact_messages) as cm, sum(r.bot_messages) as bm, sum(r.team_messages) as tm
    from public.report_daily r
    join public.bots b on b.id = r.bot_id and not b.is_demo, e
    where r.day >= (now() at time zone 'America/Sao_Paulo')::date - (p_days - 1) and r.day <= e.through
    group by r.day
  ),
  m as (
    select (m.created_at at time zone 'America/Sao_Paulo')::date as day, m.role, count(*) as n
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.bots b on b.id = c.bot_id and not b.is_demo, e
    where m.created_at >= greatest(now() - make_interval(days => p_days + 1), e.live_from)
    group by 1, 2
  ),
  c as (
    select (c.started_at at time zone 'America/Sao_Paulo')::date as day, count(*) as n
    from public.conversations c
    join public.bots b on b.id = c.bot_id and not b.is_demo, e
    where c.started_at >= greatest(now() - make_interval(days => p_days + 1), e.live_from)
    group by 1
  )
  select d.day,
    (coalesce((select a.conv from agg a where a.day = d.day), 0) + coalesce((select sum(c.n) from c where c.day = d.day), 0))::bigint,
    (coalesce((select a.cm from agg a where a.day = d.day), 0) + coalesce((select sum(m.n) from m where m.day = d.day and m.role = 'user'), 0))::bigint,
    (coalesce((select a.bm from agg a where a.day = d.day), 0) + coalesce((select sum(m.n) from m where m.day = d.day and m.role = 'assistant'), 0))::bigint,
    (coalesce((select a.tm from agg a where a.day = d.day), 0) + coalesce((select sum(m.n) from m where m.day = d.day and m.role = 'agent'), 0))::bigint
  from days d
  order by d.day;
$$;

create or replace function public.admin_channel_split(p_days int)
returns table (channel text, conversations bigint)
language sql stable
set search_path = public
as $$
  with e as (
    select t.through, t.first_day,
      greatest((t.first_day::timestamp at time zone 'America/Sao_Paulo'), ((t.through + 1)::timestamp at time zone 'America/Sao_Paulo')) as live_from
    from (select coalesce(public.report_daily_through(), date '1900-01-01') as through, ((now() - make_interval(days => p_days)) at time zone 'America/Sao_Paulo')::date as first_day) t
  ),
  x as (
    select r.channel, r.conversations::bigint as n
    from public.report_daily r
    join public.bots b on b.id = r.bot_id and not b.is_demo, e
    where r.day >= e.first_day and r.day <= e.through
    union all
    select coalesce(c.channel, 'widget'), 1
    from public.conversations c
    join public.bots b on b.id = c.bot_id and not b.is_demo, e
    where c.started_at >= e.live_from
  )
  select x.channel, sum(x.n)::bigint
  from x
  group by 1
  having sum(x.n) > 0
  order by 2 desc;
$$;
revoke all on function public.admin_daily_activity(int) from public, anon, authenticated;
revoke all on function public.admin_channel_split(int) from public, anon, authenticated;
grant execute on function public.admin_daily_activity(int) to service_role;
grant execute on function public.admin_channel_split(int) to service_role;

notify pgrst, 'reload schema';

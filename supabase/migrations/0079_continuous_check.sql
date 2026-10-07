-- Boavoz · verificação contínua por cliente (leva B1', parte 4b).
--
-- Só números agregados, sem abrir conversa (termos de Tech Provider): por cliente e por semana
-- (janelas de 7 dias que terminam em p_until, a meia-noite de hoje em São Paulo; semana 0 = os 7
-- dias mais recentes), os atendimentos (report_daily), os pedidos fora do assunto (scope_refusals),
-- as detecções de item proibido do portão (gate_detections) e as mensagens que a Meta cobrou como IA
-- de uso geral (whatsapp_usage). top_bot_id: o chatbot que mais pesa no cliente (o sinal precisa de
-- um bot em compliance_checks). Os sinais e os limites ficam em src/lib/continuous-check.ts.
-- Idempotente.

create or replace function public.continuous_check_weeks(
  p_until timestamptz,
  p_weeks int default 8,
  p_agency uuid default null,
  p_ai_categories text[] default array['general_purpose_ai']
)
returns table (client_id uuid, agency_id uuid, top_bot_id uuid, atendimentos int[], refusals int[], prohibited int[], meta_ai int[])
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select bt.id as bot_id, bt.client_id as cid, bt.agency_id as aid
    from public.bots bt
    where bt.client_id is not null and not bt.is_demo and (p_agency is null or bt.agency_id = p_agency)
  ),
  ev as (
    -- dia d do relatório cobre [d 00:00, d+1 00:00) em São Paulo
    select b.cid, b.aid, b.bot_id,
      floor(extract(epoch from p_until - ((r.day + 1)::timestamp at time zone 'America/Sao_Paulo')) / 604800)::int as week,
      r.atendimentos as a, 0 as rf, 0 as pr, 0 as m
    from public.report_daily r join b on b.bot_id = r.bot_id
    where ((r.day + 1)::timestamp at time zone 'America/Sao_Paulo') <= p_until
      and ((r.day + 1)::timestamp at time zone 'America/Sao_Paulo') > p_until - make_interval(days => 7 * p_weeks)
    union all
    select b.cid, b.aid, b.bot_id, floor(extract(epoch from p_until - s.created_at) / 604800)::int, 0, 1, 0, 0
    from public.scope_refusals s join b on b.bot_id = s.bot_id
    where s.created_at < p_until and s.created_at > p_until - make_interval(days => 7 * p_weeks)
    union all
    select b.cid, b.aid, b.bot_id, floor(extract(epoch from p_until - g.created_at) / 604800)::int, 0, 0, 1, 0
    from public.gate_detections g join b on b.bot_id = g.bot_id
    where g.created_at < p_until and g.created_at > p_until - make_interval(days => 7 * p_weeks) and g.decision in ('proibido', 'proibido_misto')
    union all
    select b.cid, b.aid, b.bot_id, floor(extract(epoch from p_until - u.created_at) / 604800)::int, 0, 0, 0, 1
    from public.whatsapp_usage u join b on b.bot_id = u.bot_id
    where u.created_at < p_until and u.created_at > p_until - make_interval(days => 7 * p_weeks) and u.category = any (p_ai_categories)
  ),
  top as (
    select distinct on (x.cid) x.cid, x.bot_id
    from (select ev.cid, ev.bot_id, sum(ev.a + ev.rf + ev.pr + ev.m) as total from ev group by ev.cid, ev.bot_id) x
    order by x.cid, x.total desc, x.bot_id
  ),
  weekly as (
    select ev.cid, ev.aid, ev.week, sum(ev.a)::int as a, sum(ev.rf)::int as rf, sum(ev.pr)::int as pr, sum(ev.m)::int as m
    from ev group by ev.cid, ev.aid, ev.week
  ),
  c as (select distinct weekly.cid, weekly.aid from weekly)
  select c.cid, c.aid, top.bot_id,
    array(select coalesce(w.a, 0) from generate_series(0, p_weeks - 1) g left join weekly w on w.cid = c.cid and w.week = g order by g),
    array(select coalesce(w.rf, 0) from generate_series(0, p_weeks - 1) g left join weekly w on w.cid = c.cid and w.week = g order by g),
    array(select coalesce(w.pr, 0) from generate_series(0, p_weeks - 1) g left join weekly w on w.cid = c.cid and w.week = g order by g),
    array(select coalesce(w.m, 0) from generate_series(0, p_weeks - 1) g left join weekly w on w.cid = c.cid and w.week = g order by g)
  from c join top on top.cid = c.cid
  order by c.cid
$$;

revoke all on function public.continuous_check_weeks(timestamptz, int, uuid, text[]) from public, anon, authenticated;
grant execute on function public.continuous_check_weeks(timestamptz, int, uuid, text[]) to service_role;

notify pgrst, 'reload schema';

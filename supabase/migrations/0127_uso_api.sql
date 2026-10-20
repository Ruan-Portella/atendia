-- Boavoz · uso do mês pela API (D', parte 4d, 19/10/2026; spec, "API de provisionamento", GET
-- /v1/usage).
--
-- agency_month_usage ganha o fim do mês (p_month_end; antes contava do começo do mês até agora, o
-- que só servia para o mês corrente), os contatos de campanhas e lembretes de cada chatbot (envios
-- que saíram no mês) e deixa de fora os modelos e as versões deles (não atendem ninguém). A troca
-- do retorno pede apagar a função antes. Idempotente.

drop function if exists public.agency_month_usage(uuid, timestamptz, text);
drop function if exists public.agency_month_usage(uuid, timestamptz, text, timestamptz);
create function public.agency_month_usage(p_agency_id uuid, p_month_start timestamptz, p_period text, p_month_end timestamptz default null)
returns table (bot_id uuid, client_id uuid, atendimentos bigint, messages bigint, meta_billed jsonb, campaign_contacts bigint)
language sql
stable
security definer
set search_path = public
as $$
  with a as (
    select x.bot_id, count(*) as n from public.atendimentos x
    where x.agency_id = p_agency_id and x.started_at >= p_month_start and (p_month_end is null or x.started_at < p_month_end)
    group by x.bot_id
  ), m as (
    select c.bot_id, count(*) as n
    from public.messages msg
    join public.conversations c on c.id = msg.conversation_id
    join public.bots b on b.id = c.bot_id
    where b.agency_id = p_agency_id and msg.created_at >= p_month_start and (p_month_end is null or msg.created_at < p_month_end) and msg.blocked_reason is null
    group by c.bot_id
  ), w as (
    select u.bot_id, jsonb_object_agg(u.category, u.billed) as billed
    from (
      select wu.bot_id, wu.category, count(*) filter (where wu.billable) as billed
      from public.whatsapp_usage wu
      join public.bots b on b.id = wu.bot_id
      where b.agency_id = p_agency_id and wu.period = p_period
      group by wu.bot_id, wu.category
    ) u
    group by u.bot_id
  ), k as (
    select cp.bot_id, count(*) as n
    from public.campaign_sends s
    join public.campaigns cp on cp.id = s.campaign_id
    where cp.agency_id = p_agency_id and s.status in ('sent', 'delivered', 'read') and s.sent_at >= p_month_start and (p_month_end is null or s.sent_at < p_month_end)
    group by cp.bot_id
  )
  select b.id, b.client_id, coalesce(a.n, 0), coalesce(m.n, 0), coalesce(w.billed, '{}'::jsonb), coalesce(k.n, 0)
  from public.bots b
  left join a on a.bot_id = b.id
  left join m on m.bot_id = b.id
  left join w on w.bot_id = b.id
  left join k on k.bot_id = b.id
  where b.agency_id = p_agency_id and not b.is_demo and not b.is_template;
$$;
revoke all on function public.agency_month_usage(uuid, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.agency_month_usage(uuid, timestamptz, text, timestamptz) to service_role;

notify pgrst, 'reload schema';

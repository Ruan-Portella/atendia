-- Boavoz · custo das avaliações da IA (conjunto de casos do backoffice) no ai_usage, tipo
-- "avaliacao": entra no custo da plataforma (bate com a conta da OpenAI), mas não na margem da
-- agência dona do bot de teste. Idempotente.

alter table public.eval_runs add column if not exists total_cost_usd numeric(12,6); -- respostas + classificador + busca

-- Custo de IA do mês por agência, sem as avaliações (custo da plataforma, não da agência)
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
    coalesce((select sum(x.cost_usd) from public.ai_usage x where x.agency_id = a.id and x.created_at >= p_month_start and x.kind <> 'avaliacao'), 0),
    (select max(c.last_message_at) from public.conversations c join public.bots b on b.id = c.bot_id where b.agency_id = a.id)
  from public.agencies a
  where a.owner_id is not null;
$$;
revoke all on function public.admin_agency_stats(text, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_agency_stats(text, timestamptz) to service_role;

-- Boavoz · backoffice, 2ª entrega: custos fixos (margem completa), consumo do WhatsApp por agência
-- e contas de qualidade da IA. Idempotente. Interno: RLS ligada, sem policy, só a service role.

-- Custos fixos mensais da plataforma (Vercel, Supabase, Resend, domínio…), digitados no
-- backoffice. Entram na margem: receita − IA − custos fixos.
create table if not exists public.platform_costs (
  id bigserial primary key,
  name text not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'BRL' check (currency in ('BRL', 'USD')),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_costs enable row level security;
grant all on public.platform_costs to service_role;
grant usage, select on sequence public.platform_costs_id_seq to service_role;

-- Mensagens do WhatsApp por agência e categoria num mês (a Meta cobra no cartão de cada cliente:
-- é informação para o suporte, não custo da BoaVoz).
create or replace function public.admin_whatsapp_usage(p_period text)
returns table (agency_id uuid, category text, sent bigint, billed bigint)
language sql stable
set search_path = public
as $$
  select b.agency_id, w.category, count(*), count(*) filter (where w.billable)
  from public.whatsapp_usage w
  join public.bots b on b.id = w.bot_id
  where w.period = p_period
  group by 1, 2;
$$;

-- Contas de qualidade desde uma data, numa tabela só (métrica, chave, quantidade):
-- perguntas sem resposta pendentes por bot, recusas de escopo por nível e por bot, portão por
-- etapa/decisão e por categoria, pedidos de atendente e urgentes (risco à vida).
create or replace function public.admin_quality_counts(p_since timestamptz)
returns table (metric text, key text, n bigint)
language sql stable
set search_path = public
as $$
  select 'sem_resposta_bot', u.bot_id::text, count(*) from public.unanswered u where not u.resolved group by 2
  union all
  select 'recusa_nivel', r.level, count(*) from public.scope_refusals r where r.created_at >= p_since group by 2
  union all
  select 'recusa_bot', r.bot_id::text, count(*) from public.scope_refusals r where r.created_at >= p_since group by 2
  union all
  select 'portao', g.stage || ':' || g.decision, count(*) from public.gate_detections g where g.created_at >= p_since group by 2
  union all
  select 'portao_categoria', cat, count(*) from public.gate_detections g, unnest(g.categories) as cat where g.created_at >= p_since group by 2
  union all
  select 'atendente', 'pedidos', count(*) from public.conversations c where c.handoff_requested_at >= p_since
  union all
  select 'atendente', 'urgentes', count(*) from public.conversations c where c.handoff_urgent_at >= p_since;
$$;

revoke all on function public.admin_whatsapp_usage(text) from public, anon, authenticated;
revoke all on function public.admin_quality_counts(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_whatsapp_usage(text) to service_role;
grant execute on function public.admin_quality_counts(timestamptz) to service_role;

create index if not exists scope_refusals_created_idx on public.scope_refusals (created_at);
create index if not exists inbound_events_status_idx on public.inbound_events (status, created_at);

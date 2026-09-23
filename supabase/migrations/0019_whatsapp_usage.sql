-- Boavoz · WhatsApp: consumo por mensagem, como a Meta informa nos status do webhook (pricing)
-- Idempotente.

-- Uma linha por mensagem enviada (a Meta repete o pricing em sent/delivered/read: fica a primeira).
-- Sem conteúdo nem destinatário: só o que é preciso para somar o custo.
create table if not exists public.whatsapp_usage (
  message_id text primary key,
  bot_id uuid not null references public.bots(id) on delete cascade,
  phone_number_id text not null,
  period text not null,          -- mês no horário de Brasília, "2026-10"
  category text not null,        -- service, utility, marketing, authentication…
  billable boolean not null,
  pricing_type text,             -- regular, free_customer_service, free_entry_point
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_usage_bot_period_idx on public.whatsapp_usage (bot_id, period);

alter table public.whatsapp_usage enable row level security;
drop policy if exists whatsapp_usage_owner on public.whatsapp_usage;
create policy whatsapp_usage_owner on public.whatsapp_usage for select
  using (bot_id in (select id from public.bots where agency_id = public.my_agency_id()));

-- Totais do mês por categoria (enviadas e cobradas), sem trazer linha a linha para o servidor.
create or replace function public.whatsapp_usage_summary(p_bot_id uuid, p_period text)
returns table (category text, sent bigint, billed bigint)
language sql stable
as $$
  select u.category, count(*) as sent, count(*) filter (where u.billable) as billed
  from public.whatsapp_usage u
  where u.bot_id = p_bot_id and u.period = p_period
  group by u.category
$$;

notify pgrst, 'reload schema';

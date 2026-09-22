-- Atendia · clientes com vários chatbots + desempenho do painel
-- Rode no SQL Editor do Supabase depois da 0003. Idempotente.
--
-- Antes: 1 chatbot = 1 cliente (client_name/client_site/price_cents no próprio bot).
-- Agora: a agência tem clientes; cada cliente tem N chatbots. O preço cobrado mora no cliente.
-- bots.client_name continua existindo como cópia do nome do cliente (o chat, o widget e as
-- demos leem dali) e é mantido em sincronia por trigger. Demos continuam sem cliente.

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null,
  site text,
  price_cents int,                          -- quanto a agência cobra deste cliente por mês
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clients_agency_idx on public.clients(agency_id, name);

alter table public.bots add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists bots_client_idx on public.bots(client_id);

-- Migra os chatbots existentes: um cliente por (agência, nome do cliente).
do $$
declare r record; cid uuid;
begin
  for r in
    select agency_id, client_name, max(client_site) as site, sum(price_cents)::int as price
    from public.bots
    where not is_demo and client_id is null
    group by agency_id, client_name
  loop
    select id into cid from public.clients where agency_id = r.agency_id and name = r.client_name limit 1;
    if cid is null then
      insert into public.clients (agency_id, name, site, price_cents) values (r.agency_id, r.client_name, r.site, r.price) returning id into cid;
    end if;
    update public.bots set client_id = cid where agency_id = r.agency_id and client_name = r.client_name and not is_demo and client_id is null;
  end loop;
end $$;

drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients for each row execute function public.set_updated_at();

-- Renomear o cliente renomeia a cópia nos chatbots dele.
create or replace function public.sync_client_name() returns trigger language plpgsql as $$
begin
  if new.name is distinct from old.name then
    update public.bots set client_name = new.name where client_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists clients_sync_name on public.clients;
create trigger clients_sync_name after update of name on public.clients for each row execute function public.sync_client_name();

alter table public.clients enable row level security;

-- ---------------------------------------------------------------------------
-- RLS mais rápida: `(select my_agency_id())` vira um InitPlan e roda UMA vez por consulta,
-- em vez de uma vez por linha. Em tabelas grandes (conversas, leads) a diferença é enorme.
-- ---------------------------------------------------------------------------
create or replace function public.my_agency_id() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.agencies where owner_id = auth.uid()
$$;

create or replace function public.my_bot_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id from public.bots b join public.agencies a on a.id = b.agency_id where a.owner_id = auth.uid()
$$;

drop policy if exists clients_owner on public.clients;
create policy clients_owner on public.clients for all using (agency_id = (select public.my_agency_id())) with check (agency_id = (select public.my_agency_id()));

drop policy if exists agencies_owner on public.agencies;
create policy agencies_owner on public.agencies for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists bots_owner on public.bots;
create policy bots_owner on public.bots for all using (agency_id = (select public.my_agency_id())) with check (agency_id = (select public.my_agency_id()));

drop policy if exists sources_owner on public.sources;
create policy sources_owner on public.sources for all
  using (bot_id in (select public.my_bot_ids())) with check (bot_id in (select public.my_bot_ids()));

drop policy if exists chunks_owner_read on public.chunks;
create policy chunks_owner_read on public.chunks for select using (bot_id in (select public.my_bot_ids()));

drop policy if exists conversations_owner on public.conversations;
create policy conversations_owner on public.conversations for select using (bot_id in (select public.my_bot_ids()));

drop policy if exists messages_owner on public.messages;
create policy messages_owner on public.messages for select
  using (conversation_id in (select c.id from public.conversations c where c.bot_id in (select public.my_bot_ids())));

drop policy if exists leads_owner on public.leads;
create policy leads_owner on public.leads for all
  using (bot_id in (select public.my_bot_ids())) with check (bot_id in (select public.my_bot_ids()));

drop policy if exists unanswered_owner on public.unanswered;
create policy unanswered_owner on public.unanswered for all
  using (bot_id in (select public.my_bot_ids())) with check (bot_id in (select public.my_bot_ids()));

drop policy if exists usage_owner on public.usage;
create policy usage_owner on public.usage for select using (agency_id = (select public.my_agency_id()));

drop policy if exists referrals_owner on public.referrals;
create policy referrals_owner on public.referrals for select using (referrer_id = (select public.my_agency_id()));

drop policy if exists credit_redemptions_owner on public.credit_redemptions;
create policy credit_redemptions_owner on public.credit_redemptions for select using (agency_id = (select public.my_agency_id()));

-- Índices para os filtros por período do painel
create index if not exists conversations_bot_started_idx on public.conversations(bot_id, started_at desc);
create index if not exists unanswered_bot_idx on public.unanswered(bot_id, resolved, created_at desc);

-- ---------------------------------------------------------------------------
-- Números do painel por chatbot, agregados no banco (antes o painel baixava todas as
-- conversas e leads dos últimos 30 dias só para contar). Respeita a RLS de quem chama.
-- ---------------------------------------------------------------------------
create or replace function public.bot_stats(p_since timestamptz)
returns table (bot_id uuid, conversations int, needs_human int, leads int)
language sql stable security invoker set search_path = public as $$
  select b.id,
    coalesce(c.total, 0)::int,
    coalesce(c.human, 0)::int,
    coalesce(l.total, 0)::int
  from public.bots b
  left join (
    select bot_id, count(*) as total, count(*) filter (where needs_human) as human
    from public.conversations where started_at >= p_since group by bot_id
  ) c on c.bot_id = b.id
  left join (
    select bot_id, count(*) as total from public.leads where created_at >= p_since group by bot_id
  ) l on l.bot_id = b.id;
$$;

-- Faz a API do Supabase enxergar a tabela e a função novas na hora.
notify pgrst, 'reload schema';

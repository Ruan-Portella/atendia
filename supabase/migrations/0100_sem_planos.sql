-- Boavoz · sai o modelo de planos (revisão de preços, parte 5a; 16/10/2026).
-- Conta grátis, tamanho por chatbot e pacotes por conta substituem os planos Freelancer, Agência
-- e Escala, o teste de 14 dias e os limites por plano (chatbots, membros e webhooks pausados pelo
-- plano). Sem clientes na produção: as colunas saem direto. As funções de acesso da 0073 e a
-- exportação do backoffice (0052) são recriadas antes, sem as colunas. Idempotente.

-- acesso da equipe: membro aceito e não removido (sem a pausa pelo plano)
create or replace function public.my_agency_id() returns uuid language sql stable security definer set search_path = public as $$
  select m.agency_id from public.agency_members m
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null
  limit 1
$$;

create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select m.role from public.agency_members m
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null
  limit 1
$$;

create or replace function public.my_bot_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id from public.bots b
  join public.agency_members m on m.agency_id = b.agency_id
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null
    and (m.scope = 'all' or exists (
      select 1 from public.agency_member_scopes s
      where s.member_id = m.id and (s.bot_id = b.id or (b.client_id is not null and s.client_id = b.client_id))
    ))
$$;

create or replace function public.my_client_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clients c
  join public.agency_members m on m.agency_id = c.agency_id
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null
    and (m.scope = 'all' or exists (
      select 1 from public.agency_member_scopes s
      where s.member_id = m.id and (s.client_id = c.id or s.bot_id in (select b.id from public.bots b where b.client_id = c.id))
    ))
$$;

create or replace function public.my_scope_all() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select m.scope = 'all' from public.agency_members m
    where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null
    limit 1
  ), false)
$$;

create or replace function public.my_scope_client_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select s.client_id from public.agency_member_scopes s
  join public.agency_members m on m.id = s.member_id
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null and s.client_id is not null
$$;

create or replace function public.my_scope_bot_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select s.bot_id from public.agency_member_scopes s
  join public.agency_members m on m.id = s.member_id
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null and s.bot_id is not null
$$;

-- exportação do backoffice: a situação da assinatura no lugar do plano
drop function if exists public.admin_client_export();
create or replace function public.admin_client_export()
returns table (
  agency_id uuid, agency_name text, owner_id uuid, billing_status text,
  client_id uuid, client_name text,
  bot_id uuid, bot_name text, bot_status text, bot_created_at timestamptz,
  wa_phone text, waba_id text, business_id text, coexistence boolean,
  wa_connected_at timestamptz, wa_disconnected_at timestamptz, wa_disconnect_reason text,
  has_instagram boolean, ig_username text, ig_disconnected_at timestamptz,
  compliance_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.name, a.owner_id, a.billing_status,
    c.id, coalesce(c.name, b.client_name),
    b.id, b.name, b.status, b.created_at,
    w.display_phone, w.waba_id, w.business_id, w.coexistence,
    w.created_at, w.disconnected_at, w.disconnect_reason,
    i.bot_id is not null, i.username, i.disconnected_at,
    bc.status
  from public.bots b
  join public.agencies a on a.id = b.agency_id
  left join public.clients c on c.id = b.client_id
  left join public.whatsapp_channels w on w.bot_id = b.id
  left join public.instagram_channels i on i.bot_id = b.id
  left join public.business_compliance bc on bc.client_id = b.client_id
  where not b.is_demo and a.owner_id is not null
  order by a.name, coalesce(c.name, b.client_name), b.name;
$$;
revoke all on function public.admin_client_export() from public, anon, authenticated;
grant execute on function public.admin_client_export() to service_role;

-- planos, teste de 14 dias e pausa pelo plano
alter table public.agencies drop column if exists plan;
alter table public.agencies drop column if exists trial_ends_at;
alter table public.agencies drop column if exists trial_reminder_sent_at;
alter table public.agencies drop column if exists trial_expired_notified_at;
alter table public.bots drop column if exists paused_by_plan_at;
alter table public.actions drop column if exists paused_by_plan_at;
alter table public.webhooks drop column if exists paused_by_plan_at;
alter table public.agency_members drop column if exists paused_by_plan_at;

notify pgrst, 'reload schema';

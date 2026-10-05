-- Boavoz · leva B1', parte 1: equipe da agência (papéis fixos com escopo).
--
-- agency_members passa a ser a fonte das funções de acesso: my_agency_id(), my_bot_ids(),
-- my_client_ids() e my_role() leem daqui, com o escopo do membro. O dono atual
-- (agencies.owner_id) vira uma linha owner, e owner_id continua sendo o dono para cobrança e
-- e-mails. Uma agência ativa por usuário no MVP (índice único). Papéis:
--   owner  (dono)          tudo, inclusive cobrança, afiliados e exclusão da agência
--   admin  (administrador) tudo menos cobrança; equipe, chaves, webhooks, segredos e Segurança
--   editor                 configuração de clientes e bots dentro do escopo
--   agent  (atendente)     só as conversas dos clientes e bots do escopo
-- Conversas continuam só leitura pela RLS: as escritas de atendimento conferem pela sessão e
-- gravam com a service role (ownedConversation). As escritas de configuração pela sessão ganham
-- políticas restritivas: só dono, administrador ou editor.
-- Idempotente.

create table if not exists public.agency_members (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('owner', 'admin', 'editor', 'agent')),
  scope text not null default 'all' check (scope in ('all', 'selected')),
  display_name text check (char_length(display_name) <= 40),
  avatar_url text check (char_length(avatar_url) <= 400),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  -- convite: só o hash do token do link (o token vai por e-mail e prova a posse do endereço)
  invite_token_hash text,
  invite_expires_at timestamptz,
  accepted_at timestamptz,
  removed_at timestamptz,
  -- excedente de plano (downgrade): pausa sem apagar
  paused_by_plan_at timestamptz,
  created_at timestamptz not null default now(),
  -- o dono e o administrador veem todos os clientes
  check (scope = 'all' or role in ('editor', 'agent'))
);
-- uma agência ativa por usuário
create unique index if not exists agency_members_user_active_idx on public.agency_members (user_id) where removed_at is null and user_id is not null;
-- um vínculo vivo por e-mail em cada agência (convite pendente ou aceito)
create unique index if not exists agency_members_email_active_idx on public.agency_members (agency_id, email) where removed_at is null;
-- um dono por agência
create unique index if not exists agency_members_owner_idx on public.agency_members (agency_id) where role = 'owner' and removed_at is null;
create unique index if not exists agency_members_token_idx on public.agency_members (invite_token_hash) where invite_token_hash is not null;
create index if not exists agency_members_email_idx on public.agency_members (email) where removed_at is null;

create table if not exists public.agency_member_scopes (
  id bigserial primary key,
  member_id uuid not null references public.agency_members(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  bot_id uuid references public.bots(id) on delete cascade,
  check ((client_id is null) <> (bot_id is null))
);
create unique index if not exists agency_member_scopes_client_idx on public.agency_member_scopes (member_id, client_id) where client_id is not null;
create unique index if not exists agency_member_scopes_bot_idx on public.agency_member_scopes (member_id, bot_id) where bot_id is not null;

-- só o servidor lê e grava (a tela Equipe confere o papel antes)
alter table public.agency_members enable row level security;
alter table public.agency_member_scopes enable row level security;
revoke all on public.agency_members from anon, authenticated;
revoke all on public.agency_member_scopes from anon, authenticated;
grant all on public.agency_members to service_role;
grant all on public.agency_member_scopes to service_role;
grant usage, select on sequence public.agency_member_scopes_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Dono: linha owner para cada agência (as que existem e as que nascerem)
-- ---------------------------------------------------------------------------
create or replace function public.agency_owner_member() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null then
    insert into public.agency_members (agency_id, user_id, email, role, scope, accepted_at)
    select new.id, new.owner_id, coalesce(lower(u.email), ''), 'owner', 'all', now()
    from auth.users u where u.id = new.owner_id
    on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.agency_owner_member() from public, anon, authenticated;

drop trigger if exists agencies_owner_member on public.agencies;
create trigger agencies_owner_member after insert on public.agencies for each row execute function public.agency_owner_member();

insert into public.agency_members (agency_id, user_id, email, role, scope, accepted_at, invited_at)
select a.id, a.owner_id, coalesce(lower(u.email), ''), 'owner', 'all', a.created_at, a.created_at
from public.agencies a
join auth.users u on u.id = a.owner_id
where not exists (select 1 from public.agency_members m where m.agency_id = a.id and m.role = 'owner' and m.removed_at is null)
  and not exists (select 1 from public.agency_members m where m.user_id = a.owner_id and m.removed_at is null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Funções de acesso: só o corpo muda (as políticas que já usam my_agency_id e my_bot_ids
-- passam a respeitar o vínculo e o escopo sem serem reescritas)
-- ---------------------------------------------------------------------------
create or replace function public.my_agency_id() returns uuid language sql stable security definer set search_path = public as $$
  select m.agency_id from public.agency_members m
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null and m.paused_by_plan_at is null
  limit 1
$$;

create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select m.role from public.agency_members m
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null and m.paused_by_plan_at is null
  limit 1
$$;

create or replace function public.my_can_edit() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner', 'admin', 'editor'), false)
$$;

create or replace function public.my_is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner', 'admin'), false)
$$;

create or replace function public.my_bot_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id from public.bots b
  join public.agency_members m on m.agency_id = b.agency_id
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null and m.paused_by_plan_at is null
    and (m.scope = 'all' or exists (
      select 1 from public.agency_member_scopes s
      where s.member_id = m.id and (s.bot_id = b.id or (b.client_id is not null and s.client_id = b.client_id))
    ))
$$;

create or replace function public.my_client_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clients c
  join public.agency_members m on m.agency_id = c.agency_id
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null and m.paused_by_plan_at is null
    and (m.scope = 'all' or exists (
      select 1 from public.agency_member_scopes s
      where s.member_id = m.id and (s.client_id = c.id or s.bot_id in (select b.id from public.bots b where b.client_id = c.id))
    ))
$$;

-- Escopo pelas colunas da própria linha (políticas de clients e bots): a linha recém-criada num
-- INSERT ... RETURNING ainda não aparece para uma função que lê a mesma tabela, então essas duas
-- políticas não podem depender de my_client_ids()/my_bot_ids().
create or replace function public.my_scope_all() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select m.scope = 'all' from public.agency_members m
    where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null and m.paused_by_plan_at is null
    limit 1
  ), false)
$$;

create or replace function public.my_scope_client_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select s.client_id from public.agency_member_scopes s
  join public.agency_members m on m.id = s.member_id
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null and m.paused_by_plan_at is null and s.client_id is not null
$$;

create or replace function public.my_scope_bot_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select s.bot_id from public.agency_member_scopes s
  join public.agency_members m on m.id = s.member_id
  where m.user_id = auth.uid() and m.removed_at is null and m.accepted_at is not null and m.paused_by_plan_at is null and s.bot_id is not null
$$;

-- clientes dos chatbots escolhidos um a um (o cliente aparece para chegar ao chatbot)
create or replace function public.my_scope_bot_client_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select b.client_id from public.bots b where b.id in (select public.my_scope_bot_ids()) and b.client_id is not null
$$;

revoke all on function public.my_scope_all() from public, anon;
revoke all on function public.my_scope_client_ids() from public, anon;
revoke all on function public.my_scope_bot_ids() from public, anon;
revoke all on function public.my_scope_bot_client_ids() from public, anon;
grant execute on function public.my_scope_all() to authenticated, service_role;
grant execute on function public.my_scope_client_ids() to authenticated, service_role;
grant execute on function public.my_scope_bot_ids() to authenticated, service_role;
grant execute on function public.my_scope_bot_client_ids() to authenticated, service_role;

revoke all on function public.my_role() from public, anon;
revoke all on function public.my_can_edit() from public, anon;
revoke all on function public.my_is_admin() from public, anon;
revoke all on function public.my_client_ids() from public, anon;
grant execute on function public.my_role() to authenticated, service_role;
grant execute on function public.my_can_edit() to authenticated, service_role;
grant execute on function public.my_is_admin() to authenticated, service_role;
grant execute on function public.my_client_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------

-- agência: todos os membros leem; marca, domínio e privacidade só dono e administrador
drop policy if exists agencies_owner on public.agencies;
drop policy if exists agencies_member_read on public.agencies;
drop policy if exists agencies_admin_update on public.agencies;
create policy agencies_member_read on public.agencies for select using (id = (select public.my_agency_id()));
create policy agencies_admin_update on public.agencies for update
  using (id = (select public.my_agency_id()) and (select public.my_is_admin()))
  with check (id = (select public.my_agency_id()) and (select public.my_is_admin()));

-- clientes e bots: leitura pelo escopo, conferido pelas colunas da linha; criar só dentro da
-- própria agência
drop policy if exists clients_owner on public.clients;
create policy clients_owner on public.clients for all
  using (
    agency_id = (select public.my_agency_id())
    and ((select public.my_scope_all()) or id in (select public.my_scope_client_ids()) or id in (select public.my_scope_bot_client_ids()))
  )
  with check (agency_id = (select public.my_agency_id()));

drop policy if exists bots_owner on public.bots;
create policy bots_owner on public.bots for all
  using (
    agency_id = (select public.my_agency_id())
    and ((select public.my_scope_all()) or client_id in (select public.my_scope_client_ids()) or id in (select public.my_scope_bot_ids()))
  )
  with check (agency_id = (select public.my_agency_id()));

-- pessoas do portal do cliente: pelo escopo
drop policy if exists client_members_owner on public.client_members;
create policy client_members_owner on public.client_members for all
  using (client_id in (select public.my_client_ids())) with check (client_id in (select public.my_client_ids()));

-- tabelas por bot que ainda filtravam só pela agência
drop policy if exists whatsapp_channels_owner on public.whatsapp_channels;
create policy whatsapp_channels_owner on public.whatsapp_channels for select using (bot_id in (select public.my_bot_ids()));
drop policy if exists whatsapp_usage_owner on public.whatsapp_usage;
create policy whatsapp_usage_owner on public.whatsapp_usage for select using (bot_id in (select public.my_bot_ids()));
drop policy if exists instagram_channels_owner on public.instagram_channels;
create policy instagram_channels_owner on public.instagram_channels for select using (bot_id in (select public.my_bot_ids()));
drop policy if exists contacts_agency_read on public.contacts;
create policy contacts_agency_read on public.contacts for select to authenticated using (bot_id in (select public.my_bot_ids()));
drop policy if exists contact_links_agency_read on public.contact_links;
create policy contact_links_agency_read on public.contact_links for select to authenticated using (bot_id in (select public.my_bot_ids()));
drop policy if exists gate_review_requests_agency_read on public.gate_review_requests;
create policy gate_review_requests_agency_read on public.gate_review_requests for select to authenticated using (bot_id in (select public.my_bot_ids()));
drop policy if exists report_daily_agency_read on public.report_daily;
create policy report_daily_agency_read on public.report_daily for select to authenticated using (bot_id in (select public.my_bot_ids()));
drop policy if exists attachments_agency_read on public.attachments;
create policy attachments_agency_read on public.attachments for select to authenticated using (bot_id in (select public.my_bot_ids()));
drop policy if exists business_acceptances_agency_read on public.business_acceptances;
create policy business_acceptances_agency_read on public.business_acceptances for select to authenticated using (client_id in (select public.my_client_ids()));
drop policy if exists business_compliance_agency_read on public.business_compliance;
create policy business_compliance_agency_read on public.business_compliance for select to authenticated using (client_id in (select public.my_client_ids()));

-- Segurança (auditoria, pedidos do titular, acesso do suporte): dono e administrador
drop policy if exists audit_log_agency_read on public.audit_log;
create policy audit_log_agency_read on public.audit_log for select to authenticated using (agency_id = (select public.my_agency_id()) and (select public.my_is_admin()));
drop policy if exists data_subject_requests_agency_read on public.data_subject_requests;
create policy data_subject_requests_agency_read on public.data_subject_requests for select to authenticated using (agency_id = (select public.my_agency_id()) and (select public.my_is_admin()));
drop policy if exists support_access_grants_agency_read on public.support_access_grants;
create policy support_access_grants_agency_read on public.support_access_grants for select to authenticated using (agency_id = (select public.my_agency_id()) and (select public.my_is_admin()));

-- cobrança e afiliados: só o dono
drop policy if exists usage_owner on public.usage;
create policy usage_owner on public.usage for select using (agency_id = (select public.my_agency_id()) and (select public.my_role()) = 'owner');
drop policy if exists referrals_owner on public.referrals;
create policy referrals_owner on public.referrals for select using (referrer_id = (select public.my_agency_id()) and (select public.my_role()) = 'owner');
drop policy if exists credit_redemptions_owner on public.credit_redemptions;
create policy credit_redemptions_owner on public.credit_redemptions for select using (agency_id = (select public.my_agency_id()) and (select public.my_role()) = 'owner');
drop policy if exists referral_commissions_owner on public.referral_commissions;
create policy referral_commissions_owner on public.referral_commissions for select
  using (referral_id in (select id from public.referrals where referrer_id = (select public.my_agency_id())) and (select public.my_role()) = 'owner');

-- escrita de configuração pela sessão: só dono, administrador ou editor (o atendente só lê)
do $$
declare t text;
begin
  foreach t in array array['clients', 'bots', 'sources', 'leads', 'unanswered', 'client_members'] loop
    execute format('drop policy if exists %I on public.%I', t || '_editor_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_editor_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_editor_delete', t);
    execute format('create policy %I on public.%I as restrictive for insert with check ((select public.my_can_edit()))', t || '_editor_insert', t);
    execute format('create policy %I on public.%I as restrictive for update using ((select public.my_can_edit())) with check ((select public.my_can_edit()))', t || '_editor_update', t);
    execute format('create policy %I on public.%I as restrictive for delete using ((select public.my_can_edit()))', t || '_editor_delete', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

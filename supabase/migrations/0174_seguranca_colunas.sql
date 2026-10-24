-- Boavoz · segurança (relatório de 23/10/2026: C1, A1, A2, A3, M3, M4 e o plano dos chatbots):
-- a sessão do usuário pela API do Supabase (PostgREST) gravava qualquer coluna dos chatbots do
-- escopo, inclusive a versão do modelo de outra conta (as ações e o segredo dela), o cliente de
-- outra conta e o modo dados sensíveis (sem o segundo fator); o tamanho, a cota e a demo já
-- estavam travados (0102, guard_bot_quota). O domínio próprio "verificado" saía da sessão sem a checagem do DNS (o link de entrada
-- do convite ia para o servidor de quem cadastrou). O editor de um só chatbot mudava e apagava o
-- cliente inteiro e criava gestores no portal. O bucket de logos aceitava qualquer arquivo em
-- qualquer pasta. Sem clientes na produção: aplica direto, sem transição. Idempotente.

-- 1. Chatbot só aponta para cliente, versão e modelo da mesma conta (vale para todos, até o servidor)
create or replace function public.bots_same_agency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is not null and not exists (select 1 from public.clients c where c.id = new.client_id and c.agency_id = new.agency_id) then
    raise exception 'o cliente precisa ser da mesma conta' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.bots b
    where b.id in (new.config_bot_id, new.published_bot_id, new.version_of) and b.agency_id <> new.agency_id
  ) then
    raise exception 'a versão do modelo precisa ser da mesma conta' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.bots_same_agency() from public, anon, authenticated;
drop trigger if exists bots_same_agency on public.bots;
create trigger bots_same_agency before insert or update of client_id, config_bot_id, published_bot_id, version_of, agency_id on public.bots
  for each row execute function public.bots_same_agency();

-- 2. O que só o servidor grava no chatbot: a sessão do usuário (papel authenticated) não muda
-- (o tamanho, a cota e a demo ficam com o guard_bot_quota). O nome começa com "bots_0" para rodar
-- antes dos outros gatilhos e ver só o que a sessão mandou. As funções security definer
-- (publicar, transferir) e o service role não passam por aqui.
create or replace function public.bots_session_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_template or new.template_id is not null or new.config_bot_id is not null or new.published_bot_id is not null
      or new.version_of is not null or new.published_at is not null
      or new.sensitive_mode or new.sensitive_mode_suggested_at is not null
      or new.action_secret_enc is not null or new.action_secret_prev_enc is not null or new.action_secret_prev_until is not null
      or new.action_cap_hit_at is not null or new.action_cap_kind is not null
      or new.analysis_due_at is not null or new.regulated_notice_at is not null or new.transfer_review_at is not null
    then
      raise exception 'coluna do chatbot gravada só pelo servidor' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.agency_id is distinct from old.agency_id or new.public_key is distinct from old.public_key
    or new.is_template is distinct from old.is_template or new.template_id is distinct from old.template_id
    or new.config_bot_id is distinct from old.config_bot_id or new.published_bot_id is distinct from old.published_bot_id
    or new.version_of is distinct from old.version_of or new.version_number is distinct from old.version_number
    or new.published_at is distinct from old.published_at or new.published_by is distinct from old.published_by
    or new.draft_changed_at is distinct from old.draft_changed_at
    or new.sensitive_mode is distinct from old.sensitive_mode or new.sensitive_retention_days is distinct from old.sensitive_retention_days
    or new.sensitive_mode_suggested_at is distinct from old.sensitive_mode_suggested_at
    or new.action_secret_enc is distinct from old.action_secret_enc or new.action_secret_prev_enc is distinct from old.action_secret_prev_enc
    or new.action_secret_prev_until is distinct from old.action_secret_prev_until
    or new.action_cap_hit_at is distinct from old.action_cap_hit_at or new.action_cap_kind is distinct from old.action_cap_kind
    or new.analysis_due_at is distinct from old.analysis_due_at or new.regulated_notice_at is distinct from old.regulated_notice_at
    or new.whatsapp_scope_last is distinct from old.whatsapp_scope_last
    or new.installed_at is distinct from old.installed_at or new.installed_host is distinct from old.installed_host or new.last_seen_at is distinct from old.last_seen_at
    -- a revisão depois da transferência: a sessão só dispensa
    or (new.transfer_review_at is not null and new.transfer_review_at is distinct from old.transfer_review_at)
  then
    raise exception 'coluna do chatbot gravada só pelo servidor' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists bots_0_session_guard on public.bots;
create trigger bots_0_session_guard before insert or update on public.bots
  for each row execute function public.bots_session_guard();

-- 3. Domínio próprio: só o servidor grava, depois do pacote e da checagem do DNS
revoke update (custom_domain, custom_domain_verified_at) on public.agencies from authenticated;

-- 4. Clientes: ler pelo escopo (inclusive pelo chatbot); mudar e apagar só com o cliente no escopo
drop policy if exists clients_owner on public.clients;
drop policy if exists clients_read on public.clients;
drop policy if exists clients_insert on public.clients;
drop policy if exists clients_update on public.clients;
drop policy if exists clients_delete on public.clients;
create policy clients_read on public.clients for select
  using (
    agency_id = (select public.my_agency_id())
    and ((select public.my_scope_all()) or id in (select public.my_scope_client_ids()) or id in (select public.my_scope_bot_client_ids()))
  );
create policy clients_insert on public.clients for insert with check (agency_id = (select public.my_agency_id()));
create policy clients_update on public.clients for update
  using (agency_id = (select public.my_agency_id()) and ((select public.my_scope_all()) or id in (select public.my_scope_client_ids())))
  with check (agency_id = (select public.my_agency_id()));
create policy clients_delete on public.clients for delete
  using (agency_id = (select public.my_agency_id()) and ((select public.my_scope_all()) or id in (select public.my_scope_client_ids())));

-- 5. Pessoas do portal: ler pelo escopo; convidar, mudar e tirar só com o cliente no escopo
drop policy if exists client_members_owner on public.client_members;
drop policy if exists client_members_read on public.client_members;
drop policy if exists client_members_write on public.client_members;
create policy client_members_read on public.client_members for select using (client_id in (select public.my_client_ids()));
create policy client_members_write on public.client_members for all
  using (client_id in (select public.my_client_ids()) and ((select public.my_scope_all()) or client_id in (select public.my_scope_client_ids())))
  with check (client_id in (select public.my_client_ids()) and ((select public.my_scope_all()) or client_id in (select public.my_scope_client_ids())));

-- 6. Logos e fotos de perfil: só imagem de até 2 MB, na pasta da própria conta (ou do próprio perfil)
update storage.buckets
set file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
where id = 'logos';

create or replace function public.my_avatar_folders() returns setof text language sql stable security definer set search_path = public as $$
  select m.id::text from public.agency_members m where m.user_id = auth.uid() and m.removed_at is null
  union
  select cm.id::text from public.client_members cm where cm.email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;
revoke all on function public.my_avatar_folders() from public, anon;
grant execute on function public.my_avatar_folders() to authenticated, service_role;

drop policy if exists "agência envia logo" on storage.objects;
create policy "agência envia logo" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (
      (storage.foldername(name))[1] = (select public.my_agency_id())::text
      or ((storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] in (select public.my_avatar_folders()))
    )
  );

notify pgrst, 'reload schema';

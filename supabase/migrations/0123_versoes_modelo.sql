-- Boavoz · rascunho, publicação e versões do bot modelo (D', parte 3, 19/10/2026; spec, Peça 8,
-- "Teste e versão do bot").
--
-- O modelo é o rascunho: o painel edita e o teste ao vivo usa ele. Publicar cria uma versão: uma
-- cópia fixa do modelo (bots.version_of), com a persona, a aparência, o anúncio, os assuntos e uma
-- cópia das ações e dos roteiros daquele momento. Os derivados usam a versão em vigor
-- (config_bot_id, gravado na publicação) para as ações, os roteiros e os campos herdados; a base
-- (fontes) e o que vem pela API valem na hora, sem versão. Voltar a uma versão anterior só troca o
-- ponteiro (published_bot_id e config_bot_id): as versões não mudam depois de criadas. Mudança no
-- rascunho marca draft_changed_at (gatilhos), para o painel dizer "mudanças não publicadas".
-- Idempotente.
alter table public.bots add column if not exists version_of uuid references public.bots(id) on delete cascade;
alter table public.bots add column if not exists version_number int;
alter table public.bots add column if not exists published_at timestamptz;
alter table public.bots add column if not exists published_by text;
alter table public.bots add column if not exists published_bot_id uuid references public.bots(id) on delete set null;
alter table public.bots add column if not exists config_bot_id uuid references public.bots(id) on delete set null;
alter table public.bots add column if not exists draft_changed_at timestamptz;
alter table public.bots drop constraint if exists bots_version_shape_check;
alter table public.bots add constraint bots_version_shape_check check (version_of is null or (is_template and template_id is null and client_id is null and version_number is not null));
create index if not exists bots_versions_idx on public.bots (version_of, version_number desc) where version_of is not null;
create index if not exists bots_config_bot_idx on public.bots (config_bot_id) where config_bot_id is not null;

-- o derivado aponta para o modelo (o rascunho), nunca para uma versão
create or replace function public.bots_check_template()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  t record;
begin
  if tg_op = 'UPDATE' and old.is_template and not new.is_template and exists (select 1 from public.bots d where d.template_id = new.id) then
    raise exception 'o modelo tem chatbots derivados' using errcode = '23514';
  end if;
  if new.template_id is null then
    return new;
  end if;
  if new.is_template then
    raise exception 'um modelo não deriva de outro' using errcode = '23514';
  end if;
  select b.is_template, b.agency_id, b.version_of into t from public.bots b where b.id = new.template_id;
  if not found or not t.is_template or t.version_of is not null then
    raise exception 'template_id precisa apontar para um modelo' using errcode = '23514';
  end if;
  if t.agency_id <> new.agency_id then
    raise exception 'o modelo precisa ser da mesma conta' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- rascunho mudou: a configuração do modelo
create or replace function public.template_draft_bot_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_template and new.version_of is null and (
    new.persona is distinct from old.persona or new.name is distinct from old.name or new.appearance is distinct from old.appearance
    or new.human_handoff is distinct from old.human_handoff or new.business_topics is distinct from old.business_topics
  ) then
    new.draft_changed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists bots_template_draft on public.bots;
create trigger bots_template_draft before update on public.bots for each row execute function public.template_draft_bot_touch();

-- rascunho mudou: as ações e os roteiros do modelo
create or replace function public.template_draft_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b uuid;
begin
  if tg_op = 'DELETE' then
    b := old.bot_id;
  else
    b := new.bot_id;
  end if;
  update public.bots set draft_changed_at = now() where id = b and is_template and version_of is null;
  return null;
end;
$$;
revoke all on function public.template_draft_touch() from public, anon, authenticated;
drop trigger if exists actions_template_draft on public.actions;
create trigger actions_template_draft after insert or update or delete on public.actions for each row execute function public.template_draft_touch();
drop trigger if exists routines_template_draft on public.routines;
create trigger routines_template_draft after insert or update or delete on public.routines for each row execute function public.template_draft_touch();

-- publicar: a versão nova (cópia fixa) e os derivados apontando para ela; devolve o id da versão
create or replace function public.publish_template(p_template uuid, p_by text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v uuid := gen_random_uuid();
  n int;
begin
  select * into t from public.bots where id = p_template and is_template and version_of is null for update;
  if not found then
    raise exception 'modelo não encontrado' using errcode = 'P0002';
  end if;
  select coalesce(max(version_number), 0) + 1 into n from public.bots where version_of = p_template;
  insert into public.bots (id, agency_id, is_template, version_of, version_number, published_at, published_by, client_name, name, persona, appearance, human_handoff, business_topics, template_unlocked, status)
  values (v, t.agency_id, true, p_template, n, now(), left(p_by, 120), 'Versão ' || n, t.name, t.persona, t.appearance, t.human_handoff, t.business_topics, t.template_unlocked, 'draft');
  insert into public.actions
  select (jsonb_populate_record(null::public.actions, to_jsonb(a) || jsonb_build_object('id', gen_random_uuid(), 'bot_id', v))).*
  from public.actions a
  where a.bot_id = p_template;
  insert into public.routines
  select (jsonb_populate_record(null::public.routines, to_jsonb(r) || jsonb_build_object('id', gen_random_uuid(), 'bot_id', v))).*
  from public.routines r
  where r.bot_id = p_template;
  update public.bots set published_bot_id = v where id = p_template;
  update public.bots set config_bot_id = v where template_id = p_template;
  return v;
end;
$$;
revoke all on function public.publish_template(uuid, text) from public, anon, authenticated;
grant execute on function public.publish_template(uuid, text) to service_role;

-- voltar a uma versão: só o ponteiro
create or replace function public.use_template_version(p_template uuid, p_version uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.bots where id = p_version and version_of = p_template) then
    return false;
  end if;
  update public.bots set published_bot_id = p_version where id = p_template;
  update public.bots set config_bot_id = p_version where template_id = p_template;
  return true;
end;
$$;
revoke all on function public.use_template_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.use_template_version(uuid, uuid) to service_role;

-- quem já derivou antes das versões: a primeira versão nasce agora, para os derivados não verem o rascunho
do $$
declare
  t record;
begin
  for t in select b.id from public.bots b where b.is_template and b.version_of is null and b.published_bot_id is null and exists (select 1 from public.bots d where d.template_id = b.id)
  loop
    perform public.publish_template(t.id, 'BoaVoz (primeira versão)');
  end loop;
end;
$$;

notify pgrst, 'reload schema';

-- Boavoz · auditoria mínima, registros de acesso (Marco Civil) e registro de incidentes (L1).
-- Ver src/lib/audit.ts, src/lib/access-log.ts e docs/incidentes.md. Idempotente.
--
-- As três tabelas de registro são só de inserção: o papel da aplicação (service_role) e o do
-- painel (authenticated) não têm UPDATE, DELETE nem TRUNCATE, e um gatilho recusa UPDATE e
-- DELETE de qualquer um. A única remoção é a da retenção, pela função purge_logs (SECURITY
-- DEFINER), que liga uma marca da transação que o gatilho aceita e apaga só o que venceu:
-- auditoria com mais de 1 ano, acessos com mais de 6 meses. Limite conhecido: quem tem a
-- credencial de dono do banco consegue desligar o gatilho (decisão de 25/09/2026).

-- ---------------------------------------------------------------------------
-- Auditoria: quem fez o quê (sem conteúdo de conversa; segredos só pelo nome)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigserial primary key,
  agency_id uuid,                 -- sem FK: a auditoria fica depois de encerrar a agência
  actor_type text not null check (actor_type in ('user', 'member', 'api_key', 'support', 'system', 'link')),
  actor_id text,                  -- id do usuário, e-mail do membro do portal ou do contato do link
  action text not null,
  target_type text,
  target_id text,
  before jsonb,
  after jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_agency_idx on public.audit_log (agency_id, created_at desc);
create index if not exists audit_log_created_idx on public.audit_log (created_at);

-- ---------------------------------------------------------------------------
-- Acessos ao painel (agência, área do cliente, backoffice): IP completo por 6 meses
-- ---------------------------------------------------------------------------
create table if not exists public.access_log (
  id bigserial primary key,
  agency_id uuid,
  actor_type text not null check (actor_type in ('user', 'member', 'support')),
  actor_id text not null,
  event text not null check (event in ('session', 'login', 'login_failed', 'magic_link', 'logout')),
  ip inet,
  user_agent text,
  -- só nas sessões: uma linha por pessoa, IP e dia (o proxy grava em segundo plano)
  day date,
  created_at timestamptz not null default now()
);
create unique index if not exists access_log_session_day_idx on public.access_log (actor_type, actor_id, ip, day);
create index if not exists access_log_actor_idx on public.access_log (actor_id, created_at desc);
create index if not exists access_log_created_idx on public.access_log (created_at);

-- ---------------------------------------------------------------------------
-- Visitantes do chat do site (widget e /w/KEY): IP quando a conversa começa e quando muda.
-- Sob sigilo: sem tela, consulta só por SQL (ordem judicial). Provisório até o advogado dizer
-- quem é o provedor de aplicação no widget embutido.
-- ---------------------------------------------------------------------------
create table if not exists public.widget_access_log (
  id bigserial primary key,
  bot_id uuid,
  conversation_id uuid,
  ip inet,
  created_at timestamptz not null default now()
);
create index if not exists widget_access_log_conv_idx on public.widget_access_log (conversation_id, id desc);
create index if not exists widget_access_log_created_idx on public.widget_access_log (created_at);

-- ---------------------------------------------------------------------------
-- Só inserção
-- ---------------------------------------------------------------------------
create or replace function public.logs_insert_only() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('boavoz.log_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'registro só de inserção: % não pode ser alterado nem apagado', tg_table_name;
end $$;

create or replace function public.logs_no_truncate() returns trigger language plpgsql as $$
begin
  raise exception 'registro só de inserção: % não pode ser esvaziado', tg_table_name;
end $$;

do $$
declare t text;
begin
  foreach t in array array['audit_log', 'access_log', 'widget_access_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists %I on public.%I', t || '_insert_only', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.logs_insert_only()', t || '_insert_only', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.logs_no_truncate()', t || '_no_truncate', t);
    execute format('revoke all on public.%I from anon, authenticated, service_role', t);
    execute format('grant select, insert on public.%I to service_role', t);
    execute format('grant usage, select on sequence public.%I to service_role', t || '_id_seq');
  end loop;
end $$;

-- A agência lê a própria auditoria (tela de Segurança, leva S); acessos e widget ficam internos.
drop policy if exists audit_log_agency_read on public.audit_log;
create policy audit_log_agency_read on public.audit_log for select to authenticated using (agency_id = (select public.my_agency_id()));
grant select on public.audit_log to authenticated;

-- Retenção: a única forma de remoção (rotina diária). Apaga em lotes.
create or replace function public.purge_logs(p_batch int default 5000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a int; b int; c int;
begin
  perform set_config('boavoz.log_purge', 'on', true);
  delete from public.audit_log where id in (select id from public.audit_log where created_at < now() - interval '1 year' limit p_batch);
  get diagnostics a = row_count;
  delete from public.access_log where id in (select id from public.access_log where created_at < now() - interval '6 months' limit p_batch);
  get diagnostics b = row_count;
  delete from public.widget_access_log where id in (select id from public.widget_access_log where created_at < now() - interval '6 months' limit p_batch);
  get diagnostics c = row_count;
  perform set_config('boavoz.log_purge', 'off', true);
  return jsonb_build_object('audit_log', a, 'access_log', b, 'widget_access_log', c);
end $$;
revoke all on function public.purge_logs(int) from public, anon, authenticated;
grant execute on function public.purge_logs(int) to service_role;

-- ---------------------------------------------------------------------------
-- Registro de incidentes de segurança (docs/incidentes.md): interno, sem dado pessoal no texto.
-- Guardado por 5 anos (Resolução CD/ANPD nº 15/2024).
-- ---------------------------------------------------------------------------
create table if not exists public.security_incidents (
  id bigserial primary key,
  title text not null,
  severity text not null default 'medio' check (severity in ('baixo', 'medio', 'alto')),
  status text not null default 'aberto' check (status in ('aberto', 'contido', 'encerrado')),
  detected_at timestamptz not null default now(),
  description text,               -- o que aconteceu, sem dado pessoal
  affected text,                  -- quem e quantos (agências, negócios, contatos), tipo de dado
  actions text,                   -- contenção e correção
  risk_relevant boolean,          -- risco ou dano relevante aos titulares (decide a comunicação)
  agencies_notified_at timestamptz,
  anpd_notified_at timestamptz,
  closed_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.security_incidents enable row level security; -- interna: sem policy
grant all on public.security_incidents to service_role;
grant usage, select on sequence public.security_incidents_id_seq to service_role;

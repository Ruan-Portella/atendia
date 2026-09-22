-- Atendia · acesso do cliente final (várias pessoas por cliente, permissões por cliente)
-- Idempotente.
--
-- O cliente entra por link mágico no e-mail (sem senha) na "Área do cliente" (/cliente).
-- A agência escolhe, por cliente, se ele pode atender conversas e/ou ensinar o assistente.
-- O servidor confere tudo (e-mail na lista + sessão aberta por link mágico); estas tabelas
-- não dão acesso direto ao cliente pela API.

alter table public.clients
  add column if not exists allow_handoff boolean not null default false,    -- pode assumir e responder conversas
  add column if not exists allow_knowledge boolean not null default false;  -- pode responder perguntas e editar textos/FAQs

create table if not exists public.client_members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null check (email = lower(email)),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, email)
);
create index if not exists client_members_email_idx on public.client_members(email);

alter table public.client_members enable row level security;
drop policy if exists client_members_owner on public.client_members;
create policy client_members_owner on public.client_members for all
  using (client_id in (select id from public.clients where agency_id = (select public.my_agency_id())))
  with check (client_id in (select id from public.clients where agency_id = (select public.my_agency_id())));

-- Quem fez o quê (para a agência saber se foi ela ou o cliente)
alter table public.messages add column if not exists author text;        -- mensagens 'agent': "agência" ou e-mail do cliente
alter table public.sources add column if not exists created_by text;     -- quem criou/editou por último
alter table public.unanswered add column if not exists resolved_by text; -- quem respondeu/ignorou

notify pgrst, 'reload schema';

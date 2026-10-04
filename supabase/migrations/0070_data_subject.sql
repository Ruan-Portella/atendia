-- Leva S, parte 3: pedido do titular (LGPD, art. 18). O contato pede pelo chat ("apaga meus
-- dados"), confirma, e o pedido fica aguardando a agência (operadora, em nome do negócio), que
-- confirma em Segurança; a rotina única de exclusão apaga, põe na supressão e avisa o contato. O
-- painel ("Apagar dados de um contato") usa a mesma rotina e grava o pedido já executado. A linha
-- fica depois da exclusão, como prova do atendimento (sem dado do contato).

create table if not exists public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  bot_id uuid references public.bots(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  -- onde foi pedido (o widget anônimo não tem ficha de contato: a conversa e o visitante dizem quem é)
  conversation_id uuid references public.conversations(id) on delete set null,
  channel text not null check (channel in ('widget', 'whatsapp', 'instagram', 'painel', 'api')),
  origin text not null check (origin in ('chat', 'painel', 'api')),
  kind text not null default 'exclusao' check (kind in ('exclusao')),
  status text not null default 'aguardando' check (status in ('aguardando', 'executado')),
  requested_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '15 days'),
  -- aviso à agência; confirmação (quem); execução e o que saiu (só contagens); aviso ao contato
  notified_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by text,
  executed_at timestamptz,
  summary jsonb,
  contact_notified_at timestamptz
);
create index if not exists data_subject_requests_agency_idx on public.data_subject_requests (agency_id, status, requested_at desc);
create index if not exists data_subject_requests_contact_idx on public.data_subject_requests (bot_id, contact_id) where status = 'aguardando';

alter table public.data_subject_requests enable row level security;
drop policy if exists data_subject_requests_agency_read on public.data_subject_requests;
create policy data_subject_requests_agency_read on public.data_subject_requests for select to authenticated
  using (agency_id = (select public.my_agency_id()));
revoke all on public.data_subject_requests from anon, authenticated;
grant select on public.data_subject_requests to authenticated;
grant all on public.data_subject_requests to service_role;

-- pergunta "quer que apaguemos?" em aberto (o "sim" digitado vale por 15 minutos)
alter table public.conversations add column if not exists erasure_asked_at timestamptz;

-- entregas de webhook ligadas a um contato (o corpo vai cifrado): a exclusão apaga as dele antes de
-- emitir contact.deleted
alter table public.webhook_deliveries add column if not exists contact_id uuid;
create index if not exists webhook_deliveries_contact_idx on public.webhook_deliveries (contact_id) where contact_id is not null;

notify pgrst, 'reload schema';

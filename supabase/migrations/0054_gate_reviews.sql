-- Boavoz · "isto não é {categoria}" (L1, tela Conversa): quando o portão acusa um item, a equipe
-- da agência pede revisão; só o BoaVoz aprova, e a exceção vale só para aquele chatbot (o portão
-- deixa de tratar a categoria nele). Ver src/lib/gate/exceptions.ts. Idempotente.

create table if not exists public.gate_review_requests (
  id bigserial primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  category text not null,
  note text,
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  requested_by text not null,
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
-- um pedido aberto por chatbot e categoria
create unique index if not exists gate_review_requests_open_idx on public.gate_review_requests (bot_id, category) where status = 'pendente';
create index if not exists gate_review_requests_status_idx on public.gate_review_requests (status, created_at);
create index if not exists gate_review_requests_conversation_idx on public.gate_review_requests (conversation_id);

alter table public.gate_review_requests enable row level security;
drop policy if exists gate_review_requests_agency_read on public.gate_review_requests;
create policy gate_review_requests_agency_read on public.gate_review_requests for select to authenticated
  using (agency_id = (select public.my_agency_id()));
revoke all on public.gate_review_requests from anon, authenticated;
grant select on public.gate_review_requests to authenticated;
grant all on public.gate_review_requests to service_role;
grant usage, select on sequence public.gate_review_requests_id_seq to service_role;

-- exceções aprovadas pelo BoaVoz (interna: só a service role)
create table if not exists public.bot_gate_exceptions (
  bot_id uuid not null references public.bots(id) on delete cascade,
  category text not null,
  request_id bigint references public.gate_review_requests(id) on delete set null,
  approved_by text not null,
  created_at timestamptz not null default now(),
  primary key (bot_id, category)
);
create index if not exists bot_gate_exceptions_request_idx on public.bot_gate_exceptions (request_id);
alter table public.bot_gate_exceptions enable row level security;
revoke all on public.bot_gate_exceptions from anon, authenticated;
grant all on public.bot_gate_exceptions to service_role;

notify pgrst, 'reload schema';

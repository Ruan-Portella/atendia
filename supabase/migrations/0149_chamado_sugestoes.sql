-- Chamados, parte 7b (21/10/2026): a sugestão da base antes de abrir o chamado. Cada sugestão
-- mostrada e cada "Resolveu, não preciso abrir" viram uma linha, para o relatório (chamados
-- evitados). Sem dado da pessoa: só o chatbot, o tipo, o assunto da lista e a hora.
-- Sem policy: só o servidor lê e escreve.

create table if not exists public.ticket_suggestion_events (
  id bigserial primary key,
  bot_id uuid not null references public.bots(id) on delete cascade,
  kind text not null check (kind in ('mostrada', 'resolveu')),
  subject text check (subject is null or char_length(subject) <= 60),
  created_at timestamptz not null default now()
);
create index if not exists ticket_suggestion_events_bot_idx on public.ticket_suggestion_events (bot_id, created_at);
alter table public.ticket_suggestion_events enable row level security;
revoke all on public.ticket_suggestion_events from anon, authenticated;
grant all on public.ticket_suggestion_events to service_role;
grant usage, select on sequence public.ticket_suggestion_events_id_seq to service_role;

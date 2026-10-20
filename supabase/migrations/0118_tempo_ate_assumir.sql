-- Boavoz · tempo até a equipe assumir (Lançamento, parte 4b, 19/10/2026): cada vez que alguém da
-- equipe assume uma conversa que pediu atendente, ficam o instante do pedido e o de assumir. A
-- conversa perde o takeover_at quando o atendimento acaba; a Evolução (mês a mês, no painel e no
-- relatório da área do cliente) mostra a mediana deste tempo. Sem dado pessoal: só o chatbot e os
-- dois instantes. O pedido deixado (lead_waiting_at) não entra: a pessoa não pediu para falar com
-- alguém. Ver src/lib/handoff.ts (takeOver) e src/lib/evolution.ts. Idempotente.
create table if not exists public.handoff_waits (
  id bigserial primary key,
  bot_id uuid not null references public.bots(id) on delete cascade,
  requested_at timestamptz not null,
  assumed_at timestamptz not null
);
create index if not exists handoff_waits_bot_idx on public.handoff_waits (bot_id, requested_at desc);
alter table public.handoff_waits enable row level security; -- interna: só service role
grant all on public.handoff_waits to service_role;
grant usage, select on sequence public.handoff_waits_id_seq to service_role;

notify pgrst, 'reload schema';

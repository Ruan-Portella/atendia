-- Boavoz · roteiros (B2'): o roteiro aberto não prende mais a conversa. Outro roteiro começado no
-- meio (pela palavra-chave ou pela IA) toma o lugar do aberto (replaced); o roteiro que não anda por
-- 4 mensagens seguidas do contato acaba (idle). idle_turns conta essas mensagens e zera quando o
-- roteiro anda. Ver src/lib/routine-engine.ts. Idempotente.

alter table public.routine_runs add column if not exists idle_turns int not null default 0;

alter table public.routine_runs drop constraint if exists routine_runs_end_reason_check;
alter table public.routine_runs add constraint routine_runs_end_reason_check check (
  end_reason is null or end_reason in ('handoff', 'timeout', 'routine_changed', 'step_unavailable', 'context_changed', 'cancelled', 'replaced', 'idle')
);

notify pgrst, 'reload schema';

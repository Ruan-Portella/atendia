-- Boavoz · ações (B2'): "Só no roteiro". Marcada, a IA só recebe a ação quando ela é o passo atual
-- de um roteiro ligado (ou o de um passo seguinte, na mesma vez em que a ação do passo identificou a
-- pessoa); desligar o roteiro tira a ação junto. Desmarcada (o padrão), a IA usa a ação quando
-- precisar, como antes. Ver src/lib/action-tools.ts. Idempotente.

alter table public.actions add column if not exists routine_only boolean not null default false;

notify pgrst, 'reload schema';

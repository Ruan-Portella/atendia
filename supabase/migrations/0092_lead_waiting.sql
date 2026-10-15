-- Boavoz · espera da equipe por um lead (15/10). O pedido novo de lead põe a conversa na fila
-- "esperando atendente" (handoff_requested_at), mas a pessoa não pediu para falar com alguém:
-- lead_waiting_at guarda o mesmo instante, e o painel diz "deixou um pedido para a equipe"
-- enquanto os dois forem iguais. Um pedido de atendente depois do lead vale como pedido novo
-- (avisa a equipe) e zera esta coluna. Ver src/lib/notify.ts (markLeadWaiting) e
-- src/lib/chat.ts (requestHandoff). Idempotente.

alter table public.conversations add column if not exists lead_waiting_at timestamptz;

notify pgrst, 'reload schema';

-- Boavoz · pedido de atendente urgente (risco à vida, L1)
-- Idempotente.

-- Quando a pessoa indica risco à vida ou à integridade, o pedido de atendente sai como urgente:
-- o aviso à equipe vai destacado e o painel pode priorizar a conversa.
alter table public.conversations add column if not exists handoff_urgent_at timestamptz;

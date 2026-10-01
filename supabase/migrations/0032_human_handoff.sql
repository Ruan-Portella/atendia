-- Boavoz · caminho para humano (L1, conformidade da Meta)
-- Idempotente.

-- Outros jeitos de falar com a equipe (opcionais) e o horário de atendimento (opcional):
-- {"email","phone","site","address","form_url","hours":{"1":["09:00","18:00"],...}}
-- (dia 0 = domingo, horário de Brasília). O pedido de atendente no chat continua sempre ligado.
alter table public.bots add column if not exists human_handoff jsonb;

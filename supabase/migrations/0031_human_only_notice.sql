-- Boavoz · modo só humano (cota, teste ou plano) avisado uma vez por conversa
-- Idempotente.

-- Quando a IA está parada por cota esgotada, teste vencido ou plano cancelado, a mensagem do
-- contato é gravada, vira pedido de atendente e o contato recebe o texto fixo uma vez só
-- nesta conversa (Textos legais, seção 6). Esta coluna marca quando o texto foi enviado.
alter table public.conversations add column if not exists human_only_notice_at timestamptz;

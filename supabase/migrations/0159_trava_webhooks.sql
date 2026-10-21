-- A trava de cada entrega de webhook (itens menores da conferência de 20/10, parte 1; spec, Peça 2:
-- "o consumidor que roda a cada minuto pega as entregas vencidas, com trava de 30 segundos"). Sem
-- ela, a primeira tentativa na hora, o consumidor de carona de outro evento, o tique do minuto e o
-- "reenviar falhas" podiam pegar a mesma entrega ao mesmo tempo e mandá-la duas vezes. Quem tenta
-- grava locked_until (30 s à frente) numa atualização condicional; quem chega depois pula. Se a
-- função cair no meio, a trava vence e a entrega sai no minuto seguinte. Idempotente.

alter table public.webhook_deliveries add column if not exists locked_until timestamptz;

notify pgrst, 'reload schema';

-- Boavoz · excedente do plano (leva B1', parte 4b).
--
-- Downgrade pausa o excedente sem apagar nada: paused_by_plan_at diz só se o item está disponível.
-- agency_members já tem a coluna (0073); aqui entram chatbots, ações e webhooks. Chatbot pausado
-- pelo plano fica em modo só humano (a IA não responde, a equipe continua pelo painel); ação
-- pausada não é oferecida à IA; webhook pausado não gera entregas nem acumula. A agência escolhe
-- o que fica ativo em Cobrança > Limites do plano.
-- Idempotente.

alter table public.bots add column if not exists paused_by_plan_at timestamptz;
alter table public.actions add column if not exists paused_by_plan_at timestamptz;
alter table public.webhooks add column if not exists paused_by_plan_at timestamptz;

notify pgrst, 'reload schema';

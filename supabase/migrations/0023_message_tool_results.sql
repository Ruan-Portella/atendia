-- Boavoz · resultado das ações do assistente
-- Idempotente.

-- O que as ferramentas fizeram naquela resposta (registrar lead, chamar atendente, pergunta sem
-- resposta): [{"name": "...", "output": {...}}]. Fica na própria mensagem do assistente para não
-- aparecer como fala na conversa, no widget nem nas contagens; o histórico do modelo lê daqui.
alter table public.messages add column if not exists tool_results jsonb;

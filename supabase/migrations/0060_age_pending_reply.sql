-- Boavoz · reply de ação esperando o 18+ (P1): a resposta exata de uma ação que tinha item 18+
-- e foi trocada pela pergunta de idade. Depois do "Sim" ela sai como veio (sem a IA e sem chamar a
-- ação de novo), se a pergunta foi feita há até 15 minutos. Sem cifra até a leva S. Ver
-- src/lib/gate/flow.ts. Idempotente.
alter table public.conversations add column if not exists age_pending_reply_enc text;

notify pgrst, 'reload schema';

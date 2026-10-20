-- Boavoz · aprendizado (D', parte 6, 20/10/2026; spec, linha 9 dos próximos passos): quando a
-- equipe responde na conversa o que a IA não sabia, o BoaVoz propõe a entrada da base como
-- rascunho para aprovar. A sugestão fica na própria pergunta sem resposta daquela conversa:
-- suggestion_enc ({"question", "answer"}, cifrada com a chave do cliente, porque nasce da conversa),
-- quando e quem respondeu. Aprovar é o "Responder" de sempre (vira FAQ). Ver src/lib/learning.ts.
-- Idempotente.

alter table public.unanswered add column if not exists suggestion_enc text;
alter table public.unanswered add column if not exists suggested_at timestamptz;
alter table public.unanswered add column if not exists suggested_by text;
create index if not exists unanswered_conversation_pending_idx on public.unanswered (conversation_id, created_at) where not resolved and suggestion_enc is null;

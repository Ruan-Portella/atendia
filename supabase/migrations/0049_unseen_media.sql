-- Boavoz · mídia que o assistente não vê (foto, vídeo, arquivo, story): a conversa guarda por 2
-- minutos que chegou mídia, para a pergunta que vem logo depois, em outra mensagem, receber o texto
-- fixo ("escreva o que é") em vez de uma resposta chutada. Ver src/lib/unseen-media.ts. Idempotente.
alter table public.conversations add column if not exists unseen_media_at timestamptz;
alter table public.conversations add column if not exists unseen_media_kind text;

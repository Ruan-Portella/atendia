-- Boavoz · leitura de fotos pela IA (leva de 19/10/2026), parte 1.
--
-- messages.photo_reading_enc: o que a IA leu das fotos de uma mensagem do contato (JSON com o
-- tipo, a descrição e o texto da foto já filtrado), cifrado com a chave do cliente, como o
-- conteúdo. Fica à parte do texto que o contato escreveu: o painel mostra a mensagem como chegou
-- e a IA lê a descrição junto no histórico. Some com a mensagem (retenção, exclusão, lápide).
-- Idempotente.

alter table public.messages add column if not exists photo_reading_enc text;

notify pgrst, 'reload schema';

-- Boavoz · leva B1', parte 3: componentes nativos (botões, lista e link) nas mensagens.
--
-- messages.components_enc: o componente mostrado junto da mensagem (opções ou link), em JSON
-- cifrado com a chave do cliente, como o conteúdo. O painel mostra o que o contato viu e a IA vê
-- as opções no histórico (para entender "2" ou "o segundo").
-- Idempotente.

alter table public.messages add column if not exists components_enc text;

notify pgrst, 'reload schema';

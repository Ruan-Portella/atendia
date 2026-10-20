-- Boavoz · links de conexão pela API (D', parte 4b, 19/10/2026; spec, "API de provisionamento" e
-- Peça 3).
--
-- whatsapp_connect_links.token_enc: o token do link, cifrado com a chave da plataforma
-- (secret-box), para POST /v1/bots/{id}/connect-links devolver o mesmo link enquanto ele estiver
-- aberto (pedir de novo não troca o link que a loja já recebeu; só rotate: true troca). O hash
-- continua sendo o que a página do link confere, e quem lê o banco não monta um link sem a chave.
-- Os links de antes desta migração não têm o token: a API cria um novo no lugar. Idempotente.

alter table public.whatsapp_connect_links add column if not exists token_enc text;

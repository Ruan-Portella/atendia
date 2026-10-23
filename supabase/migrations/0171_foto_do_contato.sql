-- Foto do contato (22/10/2026, a pedido do usuário: o painel fica mais profissional com a foto).
-- Só o Instagram dá a foto de quem escreve (a API de perfil do usuário; o WhatsApp não dá). A foto
-- vai cifrada com a chave do cliente, como os outros dados do contato, e mora na própria ficha: sai
-- junto com o contato no prazo de guarda e no pedido do titular. avatar_at: quando foi buscada (a
-- foto é buscada de novo quando a pessoa escreve e passou uma semana). Idempotente.
alter table public.contacts add column if not exists avatar_enc text;
alter table public.contacts add column if not exists avatar_at timestamptz;

notify pgrst, 'reload schema';

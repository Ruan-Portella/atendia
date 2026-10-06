-- Boavoz · leads com Instagram.
--
-- leads.instagram_enc: o @ do Instagram como contato (digitado pela pessoa ou, numa conversa pelo
-- Direct, o da própria conta), cifrado com a chave do cliente, como o telefone.
-- leads.channel: onde o lead foi capturado (widget, whatsapp, instagram…), para o painel dizer
-- "pelo Instagram" quando o contato é a própria conversa.
-- Idempotente.

alter table public.leads add column if not exists instagram_enc text;
alter table public.leads add column if not exists channel text;

notify pgrst, 'reload schema';

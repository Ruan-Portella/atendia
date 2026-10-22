-- Conversa mais natural (leva dos pontos de 13/10, proposta de 21/10/2026), parte 1: citar e
-- reagir no WhatsApp e no Instagram. Idempotente.
--   reply_to_id: a mensagem citada (o contato respondeu em cima dela, ou a equipe respondeu
--     citando); o painel mostra o trecho e a IA recebe o texto citado;
--   channel_msg_ref_enc: o id original da mensagem no canal, cifrado com a chave do cliente (o id do
--     WhatsApp leva o telefone do contato; a busca segue pelo hash de sempre): é o que a Meta pede
--     para a equipe citar ou reagir a uma mensagem;
--   contact_reaction / agent_reaction: a reação do contato e a da equipe na mensagem (um emoji;
--     sem emoji, tirou a reação). A IA não responde a reações.

alter table public.messages add column if not exists reply_to_id bigint references public.messages(id) on delete set null;
alter table public.messages add column if not exists channel_msg_ref_enc text;
alter table public.messages add column if not exists contact_reaction text;
alter table public.messages add column if not exists contact_reaction_at timestamptz;
alter table public.messages add column if not exists agent_reaction text;
alter table public.messages add column if not exists agent_reaction_at timestamptz;
alter table public.messages drop constraint if exists messages_contact_reaction_check;
alter table public.messages add constraint messages_contact_reaction_check check (contact_reaction is null or char_length(contact_reaction) <= 16);
alter table public.messages drop constraint if exists messages_agent_reaction_check;
alter table public.messages add constraint messages_agent_reaction_check check (agent_reaction is null or char_length(agent_reaction) <= 16);
create index if not exists messages_reply_to_idx on public.messages (reply_to_id) where reply_to_id is not null;

notify pgrst, 'reload schema';

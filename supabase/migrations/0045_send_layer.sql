-- Boavoz · camada única de envio (L1): toda mensagem que sai pelo WhatsApp ou pelo Instagram
-- passa pela regra de estado na hora do envio e fica registrada como enviada, barrada ou não
-- entregue. Ver src/lib/send.ts. Idempotente.

alter table public.messages add column if not exists channel_msg_hash text;  -- HMAC de "wa:"+wamid ou "ig:"+mid (nunca o id em texto)
alter table public.messages add column if not exists blocked_reason text;    -- barrada pela regra de estado (ex.: equipe assumiu enquanto a IA respondia)
alter table public.messages add column if not exists failed_at timestamptz;  -- o canal recusou ("não entregue" no painel)
alter table public.messages add column if not exists error_code text;
alter table public.messages add column if not exists deleted_at timestamptz; -- mensagem desfeita pelo contato (lápide)
alter table public.messages add column if not exists edited_at timestamptz;  -- mensagem editada pelo contato
create index if not exists messages_channel_msg_hash_idx on public.messages (channel_msg_hash) where channel_msg_hash is not null;

-- o id do canal em texto (o wamid contém o telefone) deixa de ser guardado: fica só a marca de enviada
update public.messages set channel_msg_id = 'enviada' where channel_msg_id is not null and channel_msg_id <> 'enviada';

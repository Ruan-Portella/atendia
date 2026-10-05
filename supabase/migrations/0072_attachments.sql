-- Leva S, parte 5: arquivos recebidos (attachments) e o arquivo dos PDFs das fontes.
-- Toda mídia que o contato manda (até 16 MB) fica no Storage, em bucket privado, cifrada com a
-- chave do cliente, no caminho c/{cliente}/b/{chatbot}/{id}; é entregue só pela rota /api/files/{id}
-- (agência dona, pessoas do cliente, suporte com liberação). O objeto sai do Storage antes da
-- linha: a limpeza, o pedido do titular, a conversa excluída e a mensagem desfeita apagam os dois;
-- uma varredura diária remove o que ficou sem conversa (chatbot ou cliente excluído) e o que venceu
-- (modo dados sensíveis: até 30 dias).

insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false) on conflict (id) do nothing;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  -- ids soltos: a linha fica até a varredura apagar o objeto, mesmo sem o chatbot
  agency_id uuid not null,
  client_id uuid,
  bot_id uuid not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id bigint references public.messages(id) on delete set null,
  channel text not null check (channel in ('whatsapp', 'instagram', 'widget')),
  mime text not null,
  size int not null,
  doc_type text not null check (doc_type in ('image', 'audio', 'video', 'document', 'sticker')),
  filename_enc text,
  storage_path text not null unique,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists attachments_message_idx on public.attachments (message_id);
create index if not exists attachments_conversation_idx on public.attachments (conversation_id);
create index if not exists attachments_bot_idx on public.attachments (bot_id, created_at);
create index if not exists attachments_orphan_idx on public.attachments (created_at) where conversation_id is null;
create index if not exists attachments_expires_idx on public.attachments (expires_at) where expires_at is not null;

alter table public.attachments enable row level security;
drop policy if exists attachments_agency_read on public.attachments;
create policy attachments_agency_read on public.attachments for select to authenticated
  using (agency_id = (select public.my_agency_id()));
revoke all on public.attachments from anon, authenticated;
grant select on public.attachments to authenticated;
grant all on public.attachments to service_role;

-- PDF das fontes: onde o arquivo está (apagar ou trocar a fonte apaga o arquivo)
alter table public.sources add column if not exists file_path text;

notify pgrst, 'reload schema';

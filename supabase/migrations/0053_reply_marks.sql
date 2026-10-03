-- Boavoz · conversa assumida sem resposta (L1, tela Conversa): a conversa guarda quando o contato
-- escreveu por último e quando alguém respondeu (equipe ou IA, fora os textos fixos do sistema e
-- o que não saiu). Assumida há mais de 1 hora com a última fala do contato sem resposta, ela volta
-- para "aguardando" com o selo "assumida, sem resposta". Ver src/lib/handoff-status.ts. Idempotente.

alter table public.conversations add column if not exists last_contact_at timestamptz;
alter table public.conversations add column if not exists last_reply_at timestamptz;

create or replace function public.conversation_reply_marks() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'user' then
    update public.conversations set last_contact_at = greatest(coalesce(last_contact_at, new.created_at), new.created_at) where id = new.conversation_id;
  elsif new.role in ('agent', 'assistant')
    and new.blocked_reason is null and new.failed_at is null
    and coalesce(new.author, '') <> 'sistema' then
    update public.conversations set last_reply_at = greatest(coalesce(last_reply_at, new.created_at), new.created_at) where id = new.conversation_id;
  end if;
  return null;
end;
$$;

drop trigger if exists messages_reply_marks on public.messages;
create trigger messages_reply_marks after insert on public.messages
  for each row execute function public.conversation_reply_marks();

-- conversas de antes: só as dos últimos 7 dias (a lista de "aguardando" olha 7 dias)
update public.conversations c set
  last_contact_at = (select max(m.created_at) from public.messages m where m.conversation_id = c.id and m.role = 'user'),
  last_reply_at = (
    select max(m.created_at) from public.messages m
    where m.conversation_id = c.id and m.role in ('agent', 'assistant')
      and m.blocked_reason is null and m.failed_at is null and coalesce(m.author, '') <> 'sistema'
  )
where c.last_message_at > now() - interval '7 days' and c.last_contact_at is null;

notify pgrst, 'reload schema';

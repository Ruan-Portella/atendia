-- Correção da 0168 (22/10/2026): o texto das mensagens fica cifrado (messages.content), então a
-- função devolve o texto inteiro, sem cortar; o servidor abre a cifra e corta o começo para a lista.
create or replace function public.inbox_last_messages(conv_ids uuid[])
returns table (conversation_id uuid, role text, content text, created_at timestamptz)
language sql
stable
set search_path = public
as $$
  select distinct on (m.conversation_id) m.conversation_id, m.role::text, m.content, m.created_at
  from public.messages m
  where m.conversation_id = any(conv_ids)
    and m.role in ('user', 'assistant', 'agent')
    and m.deleted_at is null
    and m.blocked_reason is null
  order by m.conversation_id, m.id desc;
$$;

revoke all on function public.inbox_last_messages(uuid[]) from public, anon, authenticated;
grant execute on function public.inbox_last_messages(uuid[]) to service_role;

notify pgrst, 'reload schema';

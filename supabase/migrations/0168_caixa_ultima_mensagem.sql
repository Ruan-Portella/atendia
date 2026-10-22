-- Redesenho, etapa 2 (22/10/2026): a lista da Caixa de entrada mostra o começo da última mensagem
-- de cada conversa (do contato, da IA ou da equipe; sem as apagadas e as que não saíram). Uma
-- chamada só para a lista inteira, pelo índice messages_conv_idx (conversa, id). Só o servidor
-- chama (service role). Idempotente.
create or replace function public.inbox_last_messages(conv_ids uuid[])
returns table (conversation_id uuid, role text, content text, created_at timestamptz)
language sql
stable
set search_path = public
as $$
  select distinct on (m.conversation_id) m.conversation_id, m.role::text, left(m.content, 160), m.created_at
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

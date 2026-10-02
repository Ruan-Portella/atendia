-- Boavoz · Instagram (L1): post e reel compartilhados reconhecidos, mensagem editada e mensagem
-- desfeita pelo contato; e o aviso "uma vez por episódio" passa da conversa para o contato.
-- Ver src/lib/instagram-edits.ts. Idempotente.

-- referência do post ou reel compartilhado no momento da mensagem (tipo, id, link, legenda)
alter table public.messages add column if not exists channel_ref jsonb;

-- aviso de indisponível uma vez por contato e episódio (não por conversa): zera quando volta ao normal
alter table public.contacts add column if not exists unavailable_notice_at timestamptz;
alter table public.contacts add column if not exists unavailable_notice_reason text;

-- restauração de backup: reaplica as exclusões, inclusive o conteúdo das mensagens desfeitas
-- pelo contato (lápide: a linha fica, o conteúdo some) e as desfeitas antes de chegarem
create or replace function public.reapply_deletions()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; c int;
begin
  for r in select distinct table_name, row_id from public.deletion_log loop
    if r.table_name in ('conversations', 'leads', 'instagram_channels', 'whatsapp_channels', 'bots', 'clients', 'unanswered', 'contacts') then
      execute format('delete from public.%I where id::text = $1', r.table_name) using r.row_id;
      get diagnostics c = row_count;
      n := n + c;
    elsif r.table_name = 'message_content' then
      update public.messages set content = '(mensagem apagada pelo contato)', channel_ref = null, deleted_at = coalesce(deleted_at, now())
        where id::text = r.row_id and (deleted_at is null or content <> '(mensagem apagada pelo contato)');
      get diagnostics c = row_count;
      n := n + c;
    elsif r.table_name = 'inbound_key' then
      update public.messages set content = '(mensagem apagada pelo contato)', channel_ref = null, deleted_at = coalesce(deleted_at, now())
        where inbound_key = r.row_id and (deleted_at is null or content <> '(mensagem apagada pelo contato)');
      get diagnostics c = row_count;
      n := n + c;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.reapply_deletions() from public, anon, authenticated;

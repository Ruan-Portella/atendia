-- Boavoz · exclusão da conta pelo dono, com 7 dias para desistir (Lançamento, parte 1,
-- 19/10/2026). O pedido marca a data; até lá tudo funciona e o dono pode desistir. Na data, o
-- cron diário desconecta os canais, cancela a assinatura, apaga os arquivos e a agência (o resto
-- vai em cascata) e as contas da equipe. A auditoria (sem FK) e os registros de acesso ficam, nos
-- prazos de sempre. Ver src/lib/account-deletion.ts. Idempotente.
alter table public.agencies add column if not exists deletion_requested_at timestamptz;
alter table public.agencies add column if not exists deletion_scheduled_for timestamptz;
alter table public.agencies add column if not exists deletion_requested_by uuid;
-- o pedido parou a renovação da assinatura na Stripe (desistir volta a renovar)
alter table public.agencies add column if not exists deletion_billing_paused boolean not null default false;
create index if not exists agencies_deletion_due_idx on public.agencies (deletion_scheduled_for) where deletion_scheduled_for is not null;

-- restaurar um backup apaga de novo a agência (o resto vai em cascata) e as contas da equipe
create or replace function public.reapply_deletions()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; c int;
begin
  for r in select distinct table_name, row_id from public.deletion_log loop
    if r.table_name in ('conversations', 'leads', 'instagram_channels', 'whatsapp_channels', 'bots', 'clients', 'unanswered', 'contacts', 'agencies') then
      execute format('delete from public.%I where id::text = $1', r.table_name) using r.row_id;
      get diagnostics c = row_count;
      n := n + c;
    elsif r.table_name = 'auth_users' then
      delete from auth.users where id::text = r.row_id;
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

notify pgrst, 'reload schema';

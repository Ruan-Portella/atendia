-- Boavoz · eventos de mensagem nos webhooks (C pública, parte 2a).
--
-- messages.delivery_status: o status mais avançado que o canal informou (sent → delivered → read,
-- ou failed), para message.status só sair quando avança (um delivered atrasado não sai depois do
-- read). webhook_deliveries.message_id: a mensagem do evento, para a mensagem desfeita apagar as
-- entregas dela antes do message.deleted.
-- O tique por minuto do Supabase (migração 0082) passa a chamar também quando há nova tentativa de
-- webhook vencida: no plano Hobby a varredura da Vercel roda uma vez por dia.
-- Idempotente.

alter table public.messages add column if not exists delivery_status text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_delivery_status_check') then
    alter table public.messages add constraint messages_delivery_status_check check (delivery_status is null or delivery_status in ('sent', 'delivered', 'read', 'failed'));
  end if;
end $$;
create index if not exists messages_channel_msg_hash_idx on public.messages (channel_msg_hash) where channel_msg_hash is not null;

alter table public.webhook_deliveries add column if not exists message_id bigint;
create index if not exists webhook_deliveries_message_idx on public.webhook_deliveries (message_id) where message_id is not null;

create or replace function public.campaign_tick_kick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_bypass text;
begin
  if not exists (select 1 from public.campaigns where status = 'scheduled' and scheduled_at <= now() + interval '1 minute')
     and not exists (
       select 1 from public.campaign_sends s join public.campaigns c on c.id = s.campaign_id
       where c.status = 'sending' and s.status = 'queued' and s.send_at <= now() + interval '1 minute'
     )
     and not exists (select 1 from public.campaign_sends where status = 'sending')
     and not exists (
       select 1 from public.campaigns c
       where c.status = 'sending' and not exists (select 1 from public.campaign_sends s where s.campaign_id = c.id and s.status in ('queued', 'sending'))
     )
     and not exists (select 1 from public.webhook_deliveries where status = 'pending' and next_attempt_at <= now()) then
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') or to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'boavoz_campaigns_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'boavoz_cron_secret';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_bypass using 'boavoz_vercel_bypass';
  if v_url is null or v_secret is null then
    return;
  end if;
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := 55000)'
    using v_url, jsonb_strip_nulls(jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'x-vercel-protection-bypass', v_bypass));
end
$$;

revoke all on function public.campaign_tick_kick() from public, anon, authenticated;

notify pgrst, 'reload schema';

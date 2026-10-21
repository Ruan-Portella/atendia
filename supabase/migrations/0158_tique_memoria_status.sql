-- O tique das campanhas chama o BoaVoz também para a memória do contato e para a página de status
-- (correção de 21/10/2026). A função do pg_cron só chama o app quando há trabalho na fila (para
-- não gastar uma execução por minuto à toa), e a memória do contato (0151) e a conferência da página
-- de status (0157) rodam dentro do tique sem que ela soubesse: só aconteciam quando havia outro
-- trabalho pendente. Agora, a conversa parada esperando a memória e a conferência de 5 minutos
-- também chamam. Igual à 0140 no resto. Idempotente.

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
       where c.status = 'sending' and c.regua_id is null
         and not exists (select 1 from public.campaign_sends s where s.campaign_id = c.id and s.status in ('queued', 'sending'))
     )
     -- réguas (Réguas, parte 2): o planejador olha cada régua ligada a cada hora
     and not exists (
       select 1 from public.reguas r join public.campaigns c on c.regua_id = r.id
       where r.active and c.status = 'sending' and (r.planned_at is null or r.planned_at < now() - interval '1 hour')
     )
     and not exists (select 1 from public.webhook_deliveries where status = 'pending' and next_attempt_at <= now())
     and not exists (select 1 from public.conversations where ai_paused_until is not null and ai_paused_until <= now())
     -- pesquisa de satisfação: conversa com a IA parada há 30 minutos (até 2 horas), sem pesquisa no dia
     and not exists (
       select 1 from public.conversations c join public.bots b on b.id = c.bot_id
       where b.satisfaction_survey and b.paused_at is null
         and c.channel in ('whatsapp', 'instagram')
         and c.last_reply_at between now() - interval '120 minutes' and now() - interval '30 minutes'
         and c.last_contact_at >= now() - interval '23 hours'
         and c.last_reply_at > c.last_contact_at
         and coalesce(c.message_count, 0) >= 4
         and not (c.takeover_at is not null and (c.handled_at is null or c.handled_at < c.takeover_at))
         and not (c.handoff_requested_at is not null and (c.handled_at is null or c.handled_at < c.handoff_requested_at))
         and not exists (select 1 from public.satisfaction_surveys s where s.conversation_id = c.id and s.sent_at >= now() - interval '24 hours')
     )
     -- posts do Instagram (E1): leitura pedida, ou fonte de chatbot no ar sem leitura há 6 horas,
     -- com a conta conectada e sem outro leitor
     and not exists (
       select 1 from public.sources s
       join public.bots b on b.id = s.bot_id
       join public.instagram_channels ic on ic.bot_id = s.bot_id and ic.disconnected_at is null and ic.access_token_enc is not null
       where s.kind = 'instagram'
         and (s.sync_lock_until is null or s.sync_lock_until < now())
         and (s.sync_requested_at is not null or (b.status = 'live' and (s.last_refreshed_at is null or s.last_refreshed_at < now() - interval '6 hours')))
     )
     -- memória do contato (Memória e avisos, parte 1): conversa parada há 30 minutos (até 24 horas),
     -- num chatbot com a memória ligada, que ainda não foi lida
     and not exists (
       select 1 from public.conversations c join public.bots b on b.id = c.bot_id
       where b.contact_memory and not b.sensitive_mode
         and c.channel in ('whatsapp', 'instagram', 'widget') and c.contact_id is not null
         and c.last_message_at between now() - interval '24 hours' and now() - interval '30 minutes'
         and (c.memory_at is null or c.memory_at < c.last_message_at)
     )
     -- página de status: a conferência dos sinais a cada 5 minutos, com ou sem outro trabalho
     and coalesce((select max(checked_at) from public.status_current), 'epoch'::timestamptz) >= now() - interval '270 seconds'
     then
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

-- Boavoz · lembretes de utilidade por planilha (leva B3, parte 5).
--
-- Declaração de consentimento para lembretes, presa ao cliente (o negócio é o controlador), feita
-- uma vez na página do cliente: origem (cadastro, contrato, compra ou outra), o texto, quem e
-- quando. Revogar apaga os campos (o histórico fica na auditoria). Sem declaração, o lembrete só
-- vai para quem já mandou mensagem ao chatbot.
--
-- O tique por minuto passa a chamar o BoaVoz só quando há envio vencendo (os lembretes ficam dias
-- esperando a data de cada linha), envio reservado sem resposta (vira "incerto" em 5 minutos),
-- campanha agendada que começa agora ou campanha sem nada na fila (para terminar).
-- Idempotente.

alter table public.clients add column if not exists utility_consent_origin text;
alter table public.clients add column if not exists utility_consent_text text;
alter table public.clients add column if not exists utility_consent_by text;
alter table public.clients add column if not exists utility_consent_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_utility_consent_origin_check') then
    alter table public.clients add constraint clients_utility_consent_origin_check check (utility_consent_origin is null or utility_consent_origin in ('cadastro', 'contrato', 'compra', 'outro'));
  end if;
end $$;

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
     ) then
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

-- Boavoz · diagnóstico do tique das campanhas (leva B3, parte 3a).
--
-- Para o backoffice mostrar por que o envio automático não anda: se o agendamento existe, quais
-- segredos do cofre estão gravados (só os nomes, nunca o valor), as últimas execuções do
-- agendador e as últimas respostas que o BoaVoz deu às chamadas do pg_net (código HTTP e o
-- começo do corpo). Cada parte falha sozinha (sem permissão ou sem a extensão) e vira texto.
-- A chamada do tique passa a esperar até 55 s (o tique roda até 45 s): a resposta do BoaVoz
-- fica registrada em vez de "tempo esgotado".
-- Idempotente.

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
  -- nada agendado nem enviando: não chama o BoaVoz
  if not exists (select 1 from public.campaigns where status = 'sending' or (status = 'scheduled' and scheduled_at <= now() + interval '1 minute')) then
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

create or replace function public.campaign_tick_diagnostics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb := jsonb_build_object(
    'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
    'pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron')
  );
  v_part jsonb;
begin
  begin
    execute $q$select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from vault.secrets where name in ('boavoz_campaigns_url', 'boavoz_cron_secret', 'boavoz_vercel_bypass')$q$ into v_part;
    v_out := v_out || jsonb_build_object('secrets', v_part);
  exception when others then
    v_out := v_out || jsonb_build_object('secrets_error', sqlerrm);
  end;
  begin
    execute $q$select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb) from (select jobname, schedule, active from cron.job where jobname = 'boavoz-campanhas') j$q$ into v_part;
    v_out := v_out || jsonb_build_object('job', v_part);
    execute $q$select coalesce(jsonb_agg(to_jsonb(r) order by r.start_time desc), '[]'::jsonb) from (
      select d.status, left(d.return_message, 200) as message, d.start_time
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
      where j.jobname = 'boavoz-campanhas' order by d.start_time desc limit 3) r$q$ into v_part;
    v_out := v_out || jsonb_build_object('runs', v_part);
  exception when others then
    v_out := v_out || jsonb_build_object('cron_error', sqlerrm);
  end;
  begin
    execute $q$select coalesce(jsonb_agg(to_jsonb(r) order by r.created desc), '[]'::jsonb) from (
      select created, status_code, timed_out, left(error_msg, 200) as error, left(content, 160) as body
      from net._http_response order by created desc limit 5) r$q$ into v_part;
    v_out := v_out || jsonb_build_object('calls', v_part);
  exception when others then
    v_out := v_out || jsonb_build_object('calls_error', sqlerrm);
  end;
  return v_out;
end
$$;

revoke all on function public.campaign_tick_diagnostics() from public, anon, authenticated;
grant execute on function public.campaign_tick_diagnostics() to service_role;

notify pgrst, 'reload schema';

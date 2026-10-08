-- Boavoz · tique por minuto das campanhas (leva B3, parte 3a).
--
-- O plano Hobby da Vercel só agenda tarefas uma vez por dia; a decisão de 24/09 é o agendador do
-- próprio Supabase (pg_cron) chamar o BoaVoz pela rede (pg_net) a cada minuto. A chamada só sai
-- quando há campanha agendada ou enviando. O endereço e o segredo ficam no cofre do Supabase
-- (vault), um par por ambiente, gravados à mão no SQL Editor (não vão para o repositório):
--
--   select vault.create_secret('https://www.boavoz.com/api/cron/campaigns', 'boavoz_campaigns_url');
--   select vault.create_secret('<CRON_SECRET da Vercel>', 'boavoz_cron_secret');
--
-- Ambiente atrás da proteção da Vercel (a dev): mais o segredo de "Protection Bypass for
-- Automation", que vai no cabeçalho x-vercel-protection-bypass:
--
--   select vault.create_secret('<segredo de bypass da Vercel>', 'boavoz_vercel_bypass');
--
-- Sem os dois, ou sem as extensões (banco local de testes), nada acontece.
-- Idempotente.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
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
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := 5000)'
    using v_url, jsonb_strip_nulls(jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'x-vercel-protection-bypass', v_bypass));
end
$$;

revoke all on function public.campaign_tick_kick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'boavoz-campanhas') then
      perform cron.unschedule('boavoz-campanhas');
    end if;
    perform cron.schedule('boavoz-campanhas', '* * * * *', 'select public.campaign_tick_kick()');
  end if;
end $$;

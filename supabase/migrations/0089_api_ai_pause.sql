-- Boavoz · pausa da IA pela integração (C pública, parte 3a; spec Peça 3, "Pausar a IA").
--
-- Estado próprio na conversa, separado do atendimento humano (takeover_at): pausar pela API não
-- avisa a equipe nem entra na fila. Na regra de estados é o degrau "humano na conversa". Toda
-- pausa tem prazo: sem minutes, 24 horas renovadas a cada mensagem enviada pela API naquela
-- conversa (ai_pause_renews); com minutes, de 1 a 10.080. ai_pause_announce: o anúncio de entrada
-- na primeira mensagem da API e o "Voltei!" na volta da IA (padrão: sem anúncio).
-- O tique por minuto (migração 0082) passa a chamar também quando uma pausa venceu: a conversa
-- volta para a IA, que responde a última mensagem do contato se ela ficou sem resposta.
-- Idempotente.

alter table public.conversations add column if not exists ai_paused_until timestamptz;
alter table public.conversations add column if not exists ai_paused_by text;
alter table public.conversations add column if not exists ai_paused_at timestamptz;
alter table public.conversations add column if not exists ai_pause_key_id uuid references public.api_keys(id) on delete set null;
alter table public.conversations add column if not exists ai_pause_renews boolean not null default false;
alter table public.conversations add column if not exists ai_pause_announce boolean;
alter table public.conversations add column if not exists ai_pause_agent text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_ai_paused_by_check') then
    alter table public.conversations add constraint conversations_ai_paused_by_check check (ai_paused_by is null or ai_paused_by in ('api'));
  end if;
end $$;
create index if not exists conversations_ai_paused_idx on public.conversations (ai_paused_until) where ai_paused_until is not null;

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
     and not exists (select 1 from public.webhook_deliveries where status = 'pending' and next_attempt_at <= now())
     and not exists (select 1 from public.conversations where ai_paused_until is not null and ai_paused_until <= now()) then
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

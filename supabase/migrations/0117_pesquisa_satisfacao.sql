-- Boavoz · pesquisa de satisfação (Lançamento, parte 4, 19/10/2026): opcional por chatbot, no
-- WhatsApp e no Instagram, com 3 botões (Ótimo, Regular, Ruim). Sai no fim do atendimento humano
-- e depois de 30 minutos de conversa parada com a IA, uma por conversa por dia, dentro da janela
-- de 24 horas. O resultado aparece no painel e na Evolução. Ver src/lib/satisfaction.ts. Idempotente.
alter table public.bots add column if not exists satisfaction_survey boolean not null default false;

create table if not exists public.satisfaction_surveys (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'instagram')),
  -- o que fez a pesquisa sair: o fim do atendimento humano ou a conversa parada com a IA
  trigger text not null check (trigger in ('equipe', 'ia')),
  sent_at timestamptz not null default now(),
  -- 3 = ótimo, 2 = regular, 1 = ruim (null: ainda sem resposta)
  score smallint check (score between 1 and 3),
  answered_at timestamptz
);
create index if not exists satisfaction_surveys_conversation_idx on public.satisfaction_surveys (conversation_id, sent_at desc);
create index if not exists satisfaction_surveys_bot_idx on public.satisfaction_surveys (bot_id, sent_at desc);
alter table public.satisfaction_surveys enable row level security; -- interna: só service role
grant all on public.satisfaction_surveys to service_role;

create index if not exists bots_satisfaction_survey_idx on public.bots (id) where satisfaction_survey;

-- o tique de cada minuto (migrações 0082 a 0089) passa a chamar também quando há conversa parada
-- esperando a pesquisa; o resto da condição é o mesmo da 0089
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

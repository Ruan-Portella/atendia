-- BoaVoz · E1 (Lojas de Instagram), parte 1: os posts do Instagram como fonte da base.
-- Idempotente.
--
-- A fonte "instagram" (sources.kind) lê o feed da conta conectada ao chatbot (uma por chatbot).
-- Cada post fica em instagram_posts: legenda, tipo, data, link permanente e a descrição das fotos,
-- feita uma vez só pelo modelo de visão (a imagem nunca é guardada: o link da Meta vence). Os
-- trechos do post entram na busca de sempre (chunk_ids: para trocar ou tirar só os dele).
--   sources.sync_requested_at: leitura pedida (a primeira ou "Atualizar agora"; fica até acabar);
--   sources.sync_total: quantos posts há na janela (o painel mostra "40 de 100");
--   sources.sync_lock_until: trava da leitura em partes (o tique e o botão nunca leem juntos).
-- bots.post_price_rule e post_price_max_days: a regra do preço de post (Peça 9): citar a data e
-- confirmar a disponibilidade (padrão), não informar de post com mais de X dias, ou sempre informar.
-- O tique de cada minuto (campaign_tick_kick) passa a chamar o BoaVoz também quando há leitura
-- pedida ou quando a fonte de um chatbot no ar não é lida há 6 horas (a Meta não avisa post novo).

create table if not exists public.instagram_posts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  media_id text not null,
  media_type text not null check (media_type in ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')),
  is_reel boolean not null default false,
  caption text,
  caption_hash text,
  permalink text,
  posted_at timestamptz not null,
  description text,
  images int not null default 0,
  chunk_ids bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, media_id)
);
create index if not exists instagram_posts_bot_media_idx on public.instagram_posts (bot_id, media_id);
drop trigger if exists instagram_posts_updated_at on public.instagram_posts;
create trigger instagram_posts_updated_at before update on public.instagram_posts for each row execute function public.set_updated_at();
alter table public.instagram_posts enable row level security;
drop policy if exists instagram_posts_read on public.instagram_posts;
create policy instagram_posts_read on public.instagram_posts for select using (bot_id in (select public.my_bot_ids()));

alter table public.sources
  add column if not exists sync_requested_at timestamptz,
  add column if not exists sync_lock_until timestamptz,
  add column if not exists sync_total int;
create unique index if not exists sources_one_instagram_idx on public.sources (bot_id) where kind = 'instagram';
create index if not exists sources_instagram_idx on public.sources (last_refreshed_at) where kind = 'instagram';

alter table public.bots
  add column if not exists post_price_rule text not null default 'citar',
  add column if not exists post_price_max_days int not null default 30;
alter table public.bots drop constraint if exists bots_post_price_rule_check;
alter table public.bots add constraint bots_post_price_rule_check check (post_price_rule in ('citar', 'limite', 'sempre'));
alter table public.bots drop constraint if exists bots_post_price_max_days_check;
alter table public.bots add constraint bots_post_price_max_days_check check (post_price_max_days between 1 and 365);

-- trava da leitura: devolve true para quem pegou (null: outro leitor está nela)
create or replace function public.claim_source_sync(p_source uuid, p_seconds int)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.sources set sync_lock_until = now() + make_interval(secs => p_seconds)
  where id = p_source and (sync_lock_until is null or sync_lock_until < now())
  returning true;
$$;
revoke all on function public.claim_source_sync(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_source_sync(uuid, int) to service_role;

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

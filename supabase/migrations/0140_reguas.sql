-- BoaVoz · Réguas, parte 2: o motor. Uma régua por chatbot e tipo, só WhatsApp: aniversário, "faz
-- tempo que você não vem" (sumido), pós-atendimento, lembrete antes do horário e "sem resposta há
-- N dias". Ligada, ela tem uma campanha que nunca termina (campaigns.regua_id): o planejador, a cada
-- hora, põe na agenda da campanha (campaign_sends) quem entrou na régua, uma vez por pessoa e ocasião
-- (dedupe_key), e o motor da B3 envia, com o aceite, o SAIR, o limite do número, as pausas e o
-- relatório. O envio que passou da hora (a régua ficou pausada, ou o horário marcado chegou) não sai:
-- vira "expired" (campaign_sends.expires_at).
-- Idempotente.

create table if not exists public.reguas (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  bot_id uuid not null references public.bots(id) on delete cascade,
  kind text not null check (kind in ('aniversario', 'sumido', 'pos_atendimento', 'lembrete', 'sem_resposta')),
  active boolean not null default false,
  -- o modelo da Meta (a parte 3 cria o pronto); a categoria é conferida de novo a cada envio
  template_name text,
  template_language text not null default 'pt_BR',
  -- o prazo: dias (sumido, sem resposta) ou horas (pós-atendimento, lembrete); o aniversário não usa
  delay_value int check (delay_value is null or delay_value between 1 and 365),
  -- a hora do envio das réguas por dia (aniversário, sumido, sem resposta), no fuso do cliente
  send_hour int not null default 9 check (send_hour between 8 and 19),
  -- a última vez que o planejador olhou (ele volta a cada hora)
  planned_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bot_id, kind)
);
create index if not exists reguas_active_idx on public.reguas (planned_at) where active;
alter table public.reguas enable row level security;
revoke all on public.reguas from anon, authenticated;
grant all on public.reguas to service_role;

-- a campanha da régua: uma por régua, nunca termina sozinha e fica fora da lista de campanhas
alter table public.campaigns add column if not exists regua_id uuid references public.reguas(id) on delete cascade;
create unique index if not exists campaigns_regua_idx on public.campaigns (regua_id) where regua_id is not null;

-- o envio da régua tem prazo: depois dele, não sai (status "expired")
alter table public.campaign_sends add column if not exists expires_at timestamptz;
alter table public.campaign_sends drop constraint if exists campaign_sends_status_check;
alter table public.campaign_sends add constraint campaign_sends_status_check check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'uncertain', 'skipped_no_consent', 'skipped_suppressed', 'skipped_no_age', 'skipped_contact_deleted', 'opted_out', 'expired'));

-- a reserva não pega o envio que passou do prazo (o tique marca como expired antes)
create or replace function public.campaign_claim(p_campaign uuid, p_limit int, p_now timestamptz default now())
returns setof public.campaign_sends
language sql
security definer
set search_path = public
as $$
  update public.campaign_sends s
  set status = 'sending', claimed_at = p_now, updated_at = p_now
  where s.id in (
    select s2.id
    from public.campaign_sends s2
    join public.campaigns c on c.id = s2.campaign_id
    where s2.campaign_id = p_campaign and s2.status = 'queued' and s2.send_at <= p_now and c.status = 'sending'
      and (s2.expires_at is null or s2.expires_at > p_now)
    order by s2.send_at, s2.id
    limit greatest(p_limit, 0)
    for update of s2 skip locked
  )
  returning s.*
$$;
revoke all on function public.campaign_claim(uuid, int, timestamptz) from public, anon, authenticated;
grant execute on function public.campaign_claim(uuid, int, timestamptz) to service_role;

-- o tique: a campanha de régua sem fila não chama (ela não termina); a régua ligada chama a cada hora
-- para o planejador
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

-- transferência de cliente (D'): as réguas mudam de conta com o chatbot e chegam desligadas
create or replace function public.transfer_client(p_client uuid, p_to uuid, p_requested_by text, p_done_by text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from uuid;
  v_name text;
  v_bots uuid[];
  v_derived uuid;
  n_detached int := 0;
  n_actions int := 0;
  n_campaigns int := 0;
  n_reguas int := 0;
  n_keys int := 0;
  n_scoped int := 0;
  n_webhooks int := 0;
  n_secrets int := 0;
  n_leads int := 0;
  n_unsized int := 0;
  v_paying boolean;
  v_summary jsonb;
begin
  select agency_id, name into v_from, v_name from public.clients where id = p_client for update;
  if not found then
    raise exception 'cliente não encontrado' using errcode = 'P0002';
  end if;
  if v_from = p_to then
    raise exception 'o cliente já é desta conta' using errcode = '22023';
  end if;
  if not exists (select 1 from public.agencies where id = p_to) then
    raise exception 'conta de destino não encontrada' using errcode = 'P0002';
  end if;
  if length(trim(coalesce(p_requested_by, ''))) < 3 or length(trim(coalesce(p_done_by, ''))) < 3 then
    raise exception 'diga quem pediu (o negócio) e quem fez' using errcode = '22023';
  end if;
  select coalesce(array_agg(id), '{}') into v_bots from public.bots where client_id = p_client and not is_template;

  -- derivado de um modelo da origem: chatbot comum, com a versão publicada em uso
  for v_derived in select id from public.bots where id = any(v_bots) and template_id is not null loop
    perform public.detach_from_template(v_derived);
    n_detached := n_detached + 1;
  end loop;

  -- mudam de dono
  update public.clients set agency_id = p_to where id = p_client;
  update public.bots set agency_id = p_to where id = any(v_bots);
  update public.contacts set agency_id = p_to where bot_id = any(v_bots);
  update public.marketing_consents set agency_id = p_to where client_id = p_client or bot_id = any(v_bots);
  update public.data_subject_requests set agency_id = p_to where client_id = p_client or bot_id = any(v_bots);
  update public.report_daily set agency_id = p_to where bot_id = any(v_bots);
  update public.attachments set agency_id = p_to where bot_id = any(v_bots);
  update public.business_compliance set agency_id = p_to where client_id = p_client;
  update public.enforcement_actions set agency_id = p_to where bot_id = any(v_bots);
  update public.compliance_checks set agency_id = p_to where bot_id = any(v_bots);
  update public.gate_review_requests set agency_id = p_to where bot_id = any(v_bots);
  update public.campaigns set agency_id = p_to where bot_id = any(v_bots);
  update public.reguas set agency_id = p_to where bot_id = any(v_bots);

  -- ações desligadas, sem segredo e sem cabeçalhos (a conta nova confere cada uma)
  update public.actions set active = false, paused_reason = 'transferencia', secret_enc = null, headers_enc = null where bot_id = any(v_bots);
  get diagnostics n_actions = row_count;
  update public.bots set action_secret_enc = null, action_secret_prev_enc = null, action_secret_prev_until = null where id = any(v_bots);

  -- aviso de lead: sai, a não ser que o e-mail seja de alguém do cliente
  update public.bots b
  set lead_capture = coalesce(b.lead_capture, '{}'::jsonb) - 'notify_email' - 'notify_whatsapp'
  where b.id = any(v_bots)
    and (coalesce(b.lead_capture ->> 'notify_email', '') <> '' or coalesce(b.lead_capture ->> 'notify_whatsapp', '') <> '')
    and not exists (select 1 from public.client_members m where m.client_id = p_client and m.email = lower(b.lead_capture ->> 'notify_email'));
  get diagnostics n_leads = row_count;

  -- o excedente gasta o crédito da conta: a conta nova liga se quiser; tudo fica para revisão
  update public.bots set overage_enabled = false, transfer_review_at = now() where id = any(v_bots);

  -- campanhas e lembretes agendados pela origem: pausados
  update public.campaigns set status = 'paused' where bot_id = any(v_bots) and status in ('scheduled', 'sending');
  get diagnostics n_campaigns = row_count;
  -- réguas (Réguas, parte 2): desligadas; a conta nova confere e liga
  update public.reguas set active = false where bot_id = any(v_bots) and active;
  get diagnostics n_reguas = row_count;

  -- a declaração de lembretes foi feita pela origem
  update public.clients set utility_consent_origin = null, utility_consent_text = null, utility_consent_by = null, utility_consent_at = null where id = p_client;
  -- as pessoas do portal são do negócio e ficam; a chave da origem que convidou sai do registro
  update public.client_members set invited_by_key = null where client_id = p_client and invited_by_key is not null;
  -- a equipe da origem com escopo neste cliente perde o escopo
  delete from public.agency_member_scopes where client_id = p_client or bot_id = any(v_bots);

  -- chaves, webhooks e segredos de identidade da origem deixam de alcançar o cliente
  update public.api_keys set revoked_at = now() where agency_id = v_from and revoked_at is null and scope_type = 'client' and scope_client_id = p_client;
  get diagnostics n_keys = row_count;
  update public.api_keys k set scope_bot_ids = array(select x from unnest(k.scope_bot_ids) x where not (x = any(v_bots)))
  where k.agency_id = v_from and k.scope_type = 'bots' and k.scope_bot_ids && v_bots;
  get diagnostics n_scoped = row_count;
  update public.webhooks set active = false where agency_id = v_from and active and scope_type = 'client' and scope_client_id = p_client;
  get diagnostics n_webhooks = row_count;
  update public.webhooks w set scope_bot_ids = array(select x from unnest(w.scope_bot_ids) x where not (x = any(v_bots)))
  where w.agency_id = v_from and w.scope_type = 'bots' and w.scope_bot_ids && v_bots;
  update public.identity_secrets set revoked_at = now()
  where agency_id = v_from and revoked_at is null and ((scope_type = 'client' and scope_client_id = p_client) or (scope_type = 'bot' and scope_bot_id = any(v_bots)));
  get diagnostics n_secrets = row_count;

  -- cobrança: sem assinatura no destino, sem tamanho a partir do dia 1º (a origem já pagou o mês)
  select stripe_subscription_id is not null into v_paying from public.agencies where id = p_to;
  if not v_paying then
    update public.bots
    set pending_size = 'none', pending_volume_packs = null,
        pending_from = (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month') at time zone 'America/Sao_Paulo'
    where id = any(v_bots) and (size is not null or quota_override is not null);
    get diagnostics n_unsized = row_count;
  end if;

  v_summary := jsonb_build_object(
    'chatbots', coalesce(array_length(v_bots, 1), 0),
    'derivados_desligados', n_detached,
    'acoes_desligadas', n_actions,
    'avisos_de_lead_limpos', n_leads,
    'campanhas_pausadas', n_campaigns,
    'reguas_desligadas', n_reguas,
    'chaves_revogadas', n_keys,
    'chaves_com_escopo_reduzido', n_scoped,
    'webhooks_desligados', n_webhooks,
    'segredos_revogados', n_secrets,
    'sem_tamanho_no_dia_1', n_unsized,
    'destino_com_assinatura', v_paying
  );
  insert into public.client_transfers (client_id, client_name, from_agency_id, to_agency_id, requested_by, done_by, reason, summary)
  values (p_client, v_name, v_from, p_to, left(trim(p_requested_by), 300), left(trim(p_done_by), 200), nullif(left(trim(coalesce(p_reason, '')), 1000), ''), v_summary);
  return v_summary || jsonb_build_object('from_agency_id', v_from, 'bot_ids', to_jsonb(v_bots));
end;
$$;
revoke all on function public.transfer_client(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.transfer_client(uuid, uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';

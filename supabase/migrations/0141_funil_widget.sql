-- Pendências do MVP, parte 4 (20/10/2026): o funil do chat do site e as conversas por canal no
-- relatório (decisão de 28/09/2026, Ideias em avaliação). Aberturas do widget num contador leve, sem
-- dado pessoal: uma linha por dia (fuso de São Paulo) e chatbot, guardada enquanto a conta existir,
-- como o report_daily. Quem lê soma os dias do mês.

create table if not exists public.widget_opens (
  day date not null,
  bot_id uuid not null references public.bots(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  opens int not null default 0,
  primary key (day, bot_id)
);
create index if not exists widget_opens_bot_idx on public.widget_opens (bot_id, day);

alter table public.widget_opens enable row level security;
drop policy if exists widget_opens_agency_read on public.widget_opens;
create policy widget_opens_agency_read on public.widget_opens for select to authenticated
  using (agency_id = (select public.my_agency_id()));
revoke all on public.widget_opens from anon, authenticated;
grant select on public.widget_opens to authenticated;
grant all on public.widget_opens to service_role;

/** Uma abertura do widget hoje (São Paulo): soma na linha do dia. Só o servidor (rota do widget). */
create or replace function public.widget_open_hit(p_bot_id uuid)
returns void
language sql
set search_path = public
as $$
  insert into public.widget_opens as w (day, bot_id, agency_id, opens)
  select (now() at time zone 'America/Sao_Paulo')::date, b.id, b.agency_id, 1
  from public.bots b where b.id = p_bot_id
  on conflict (day, bot_id) do update set opens = w.opens + 1;
$$;
revoke all on function public.widget_open_hit(uuid) from public, anon, authenticated;
grant execute on function public.widget_open_hit(uuid) to service_role;

/**
 * Totais do período por canal (conversas, pedidos de atendente, leads e perguntas sem resposta):
 * o agregado do report_daily até o último dia agregado, mais a contagem ao vivo dos dias seguintes,
 * como o bots_summary.
 */
create or replace function public.bots_channel_summary(p_bot_ids uuid[], p_from timestamptz, p_to timestamptz)
returns table (channel text, conversations int, handoffs int, leads int, unanswered int)
language sql stable security invoker set search_path = public as $$
  with e as (
    select t.through, greatest(p_from, ((t.through + 1)::timestamp at time zone 'America/Sao_Paulo')) as live_from
    from (select coalesce(public.report_daily_through(), date '1900-01-01') as through) t
  ),
  x as (
    select r.channel, r.conversations, r.handoffs, r.leads, r.unanswered
    from public.report_daily r, e
    where r.bot_id = any(p_bot_ids)
      and r.day >= (p_from at time zone 'America/Sao_Paulo')::date
      and r.day < (p_to at time zone 'America/Sao_Paulo')::date
      and r.day <= e.through
    union all
    select coalesce(c.channel, 'widget'), 1, (c.handoff_requested_at is not null)::int, 0, 0
    from public.conversations c, e
    where c.bot_id = any(p_bot_ids) and c.started_at >= e.live_from and c.started_at < p_to
    union all
    select coalesce(c.channel, 'widget'), 0, 0, 1, 0
    from public.leads l left join public.conversations c on c.id = l.conversation_id, e
    where l.bot_id = any(p_bot_ids) and l.created_at >= e.live_from and l.created_at < p_to
    union all
    select coalesce(c.channel, 'widget'), 0, 0, 0, 1
    from public.unanswered u left join public.conversations c on c.id = u.conversation_id, e
    where u.bot_id = any(p_bot_ids) and u.created_at >= e.live_from and u.created_at < p_to
  )
  select x.channel, sum(x.conversations)::int, sum(x.handoffs)::int, sum(x.leads)::int, sum(x.unanswered)::int
  from x group by x.channel;
$$;
grant execute on function public.bots_channel_summary(uuid[], timestamptz, timestamptz) to authenticated, service_role;

-- transferência de cliente (D'): as aberturas mudam de conta com os chatbots, como o report_daily
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
  update public.widget_opens set agency_id = p_to where bot_id = any(v_bots);
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

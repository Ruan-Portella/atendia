-- Boavoz · transferência de cliente entre contas (D', parte 5, 20/10/2026; spec, "Transferência de
-- cliente"). Não tem fluxo de aceite no produto: o suporte do BoaVoz faz a mudança a pedido do
-- negócio (o controlador dos dados), pelo painel interno. Ver src/lib/client-transfer.ts.
--
-- transfer_client: uma transação só, registrada em client_transfers (e na auditoria das duas contas,
-- pelo app).
-- - Mudam de dono (só o agency_id, sem recifrar nem recalcular hash): o cliente, os chatbots, os
--   contatos, os consentimentos, os pedidos do titular, os relatórios, os arquivos, a revisão do
--   negócio, as medidas, análises e pedidos de revisão do portão de cada chatbot e as campanhas. O que
--   é preso ao chatbot ou ao cliente sem agency_id (conversas, leads, base, canais, supressão,
--   vínculos, a chave de cifra do cliente) vai junto sozinho.
-- - Ficam com a origem, como histórico: auditoria, registros de acesso, medição de IA, uso,
--   atendimentos já contados, cobrança, pacotes, crédito, autorizações de suporte e o aceite do
--   negócio (que vale só para a conta que o recebeu: a conta nova precisa de novo aceite).
-- - Cortados na hora: as chaves, os webhooks e os segredos de identidade da origem deixam de
--   alcançar o cliente; as ações ficam desligadas (motivo "transferencia"), sem segredo e sem
--   cabeçalhos; o aviso de lead sai se o e-mail não for de alguém do cliente; o excedente desliga
--   (é a conta nova que paga); campanhas e lembretes agendados pausam; a declaração de lembretes da
--   origem é revogada; cada chatbot fica marcado para revisão (transfer_review_at).
-- - Chatbot derivado de um modelo da origem vira chatbot comum, com a versão publicada em uso
--   (detach_from_template, corrigida aqui para copiar a versão, não o rascunho).
-- - Cobrança: os chatbots levam o tamanho (a origem já pagou o mês); sem assinatura no destino,
--   ficam sem tamanho a partir do dia 1º. O app sincroniza as duas assinaturas depois.
-- Idempotente.

alter table public.bots add column if not exists transfer_review_at timestamptz;
alter table public.actions add column if not exists paused_reason text;

create table if not exists public.client_transfers (
  id bigserial primary key,
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null,
  from_agency_id uuid references public.agencies(id) on delete set null,
  to_agency_id uuid references public.agencies(id) on delete set null,
  requested_by text not null,
  done_by text not null,
  reason text,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists client_transfers_client_idx on public.client_transfers (client_id, created_at desc);
alter table public.client_transfers enable row level security;
revoke all on public.client_transfers from anon, authenticated;
grant all on public.client_transfers to service_role;
grant usage, select on sequence public.client_transfers_id_seq to service_role;

-- "Desligar do modelo" (parte 2c) depois das versões (parte 3): as ações e os roteiros vêm da versão
-- publicada em uso (config_bot_id), e o ponteiro da versão sai junto com o do modelo; a base é do
-- modelo (fontes não têm versão).
create or replace function public.detach_from_template(p_bot uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
  cfg uuid;
  ctx jsonb;
  src record;
  new_source uuid;
begin
  select b.template_id, coalesce(b.config_bot_id, b.template_id), b.fixed_context into t, cfg, ctx from public.bots b where b.id = p_bot for update;
  if t is null then
    return false;
  end if;

  -- ações: todas as colunas, com id novo e o chatbot
  insert into public.actions
  select (jsonb_populate_record(null::public.actions, to_jsonb(a) || jsonb_build_object('id', gen_random_uuid(), 'bot_id', p_bot))).*
  from public.actions a
  where a.bot_id = cfg;

  -- roteiros
  insert into public.routines
  select (jsonb_populate_record(null::public.routines, to_jsonb(r) || jsonb_build_object('id', gen_random_uuid(), 'bot_id', p_bot))).*
  from public.routines r
  where r.bot_id = cfg;

  -- base: as fontes gerais e as do contexto fixo do chatbot (o PDF fica com o modelo)
  for src in
    select s.id from public.sources s
    where s.bot_id = t and (s.context is null or (ctx is not null and ctx @> s.context))
  loop
    new_source := gen_random_uuid();
    insert into public.sources
    select (jsonb_populate_record(null::public.sources, to_jsonb(s) || jsonb_build_object('id', new_source, 'bot_id', p_bot, 'file_path', null, 'api_key_id', null))).*
    from public.sources s
    where s.id = src.id;
    insert into public.chunks (bot_id, source_id, content, embedding, metadata, gate_version, gate_segments, gate_categories)
    select p_bot, new_source, c.content, c.embedding, c.metadata, c.gate_version, c.gate_segments, c.gate_categories
    from public.chunks c
    where c.source_id = src.id;
  end loop;

  -- o segredo das ações do modelo passa a ser do chatbot (se ele não tiver um)
  update public.bots b
  set action_secret_enc = coalesce(b.action_secret_enc, m.action_secret_enc),
      template_id = null,
      config_bot_id = null,
      own_base = true,
      overrides = '{}'::jsonb,
      extra_instructions = null
  from public.bots m
  where b.id = p_bot and m.id = t;
  return true;
end;
$$;
revoke all on function public.detach_from_template(uuid) from public, anon, authenticated;
grant execute on function public.detach_from_template(uuid) to service_role;

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

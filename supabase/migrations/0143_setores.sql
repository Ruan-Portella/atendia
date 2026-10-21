-- Caixa de entrada, parte 1 (20/10/2026): setores e feriados (spec, Peça 11).
-- Cada cliente (o negócio) tem setores (Vendas, Suporte, Financeiro…), que valem para todos os
-- chatbots dele: nome, horário próprio (vazio = o horário de atendimento do chatbot), a
-- distribuição das conversas (manual, ou rodízio entre quem está disponível, na parte 2) e as
-- pessoas (da agência, com o cliente no escopo, e da área do cliente). Feriados ficam no cliente
-- e valem no horário do chatbot e no dos setores: no feriado, a equipe está fora do horário.
-- A conversa ganha o setor (a triagem pela IA e a transferência, nas partes 2 e 4).
-- Sem policy: só o servidor lê e escreve (o painel confere a permissão antes).

create table if not exists public.sectors (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  hours jsonb,
  distribution text not null default 'manual' check (distribution in ('manual', 'rodizio')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sectors_client_name_idx on public.sectors (client_id, lower(btrim(name)));
alter table public.sectors enable row level security;
revoke all on public.sectors from anon, authenticated;
grant all on public.sectors to service_role;

-- pessoas de cada setor: da agência (agency_members.id) ou da área do cliente (client_members.id)
create table if not exists public.sector_members (
  sector_id uuid not null references public.sectors(id) on delete cascade,
  member_type text not null check (member_type in ('agency_member', 'client_member')),
  member_id uuid not null,
  last_assigned_at timestamptz,
  primary key (sector_id, member_type, member_id)
);
create index if not exists sector_members_member_idx on public.sector_members (member_type, member_id);
alter table public.sector_members enable row level security;
revoke all on public.sector_members from anon, authenticated;
grant all on public.sector_members to service_role;

-- feriados do negócio: datas "AAAA-MM-DD" (fuso de São Paulo)
alter table public.clients add column if not exists holidays text[] not null default '{}';

-- o setor da conversa (triagem, transferência); setor apagado: a conversa fica sem setor
alter table public.conversations add column if not exists sector_id uuid references public.sectors(id) on delete set null;
create index if not exists conversations_sector_idx on public.conversations (sector_id) where sector_id is not null;

-- transferência de cliente (D'): os setores mudam de conta com o cliente; a equipe da origem sai deles
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
  update public.sectors set agency_id = p_to where client_id = p_client;

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
  -- e sai dos setores do cliente (as pessoas da área do cliente ficam)
  delete from public.sector_members where member_type = 'agency_member' and sector_id in (select id from public.sectors where client_id = p_client);

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

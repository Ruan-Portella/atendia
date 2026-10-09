-- Boavoz · proteções das campanhas e uso (leva B3, parte 3b).
--
-- SAIR e aceite acompanham o chatbot quando ele troca de conta do WhatsApp (outro número ou outra
-- WABA). A supressão e o aceite ficam no escopo da conta (waba:<id>, ou bot:<id> sem conta), então
-- ao conectar uma conta nova:
--   - toda supressão ativa do escopo anterior passa a valer no novo (bloquear a mais é o lado seguro);
--   - o último sim ou não de cada contato do mesmo cliente (ou do próprio chatbot) vai junto, se o
--     escopo novo não tiver um registro mais recente. A prova fica igual, com carried_from dizendo
--     de onde veio.
-- bots.whatsapp_scope_last guarda o escopo da última conexão (a ligação é apagada ao desconectar).
-- campaigns.quality_at_start: a nota do número quando a campanha começou ou foi retomada; se cair
-- durante o envio, a campanha pausa.
-- usage.campaign_contacts: contatos que receberam campanha ou lembrete no mês (relatório e ritmo,
-- não é limite de plano).
-- Idempotente.

alter table public.bots add column if not exists whatsapp_scope_last text;
alter table public.suppressions add column if not exists carried_from text;
alter table public.marketing_consents add column if not exists carried_from text;
alter table public.campaigns add column if not exists quality_at_start text;
alter table public.usage add column if not exists campaign_contacts int not null default 0;

-- quem já está conectado: o escopo de hoje é o ponto de partida
update public.bots b
set whatsapp_scope_last = case when w.waba_id is not null then 'waba:' || w.waba_id else 'bot:' || b.id end
from public.whatsapp_channels w
where w.bot_id = b.id and b.whatsapp_scope_last is null;

create or replace function public.carry_whatsapp_preferences(p_bot uuid, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
  v_client uuid;
  v_sup int := 0;
  v_con int := 0;
begin
  select whatsapp_scope_last, client_id into v_from, v_client from public.bots where id = p_bot for update;
  if not found then
    return jsonb_build_object('suppressions', 0, 'consents', 0);
  end if;
  if v_from is not null and v_from <> p_to then
    insert into public.suppressions (contact_hash, channel, scope, kind, reason, source, created_at, carried_from)
    select s.contact_hash, s.channel, p_to, s.kind, s.reason, s.source, s.created_at, v_from
    from public.suppressions s
    where s.scope = v_from and s.channel = 'whatsapp' and s.revoked_at is null
      and not exists (
        select 1 from public.suppressions t
        where t.scope = p_to and t.channel = s.channel and t.contact_hash = s.contact_hash and t.kind = s.kind and t.revoked_at is null
      );
    get diagnostics v_sup = row_count;

    with latest as (
      select distinct on (c.contact_hash) c.*
      from public.marketing_consents c
      where c.scope = v_from and c.channel = 'whatsapp' and (c.bot_id = p_bot or (v_client is not null and c.client_id = v_client))
      order by c.contact_hash, c.collected_at desc, c.id desc
    )
    insert into public.marketing_consents (agency_id, client_id, bot_id, waba_id, contact_id, channel, scope, contact_hash, granted, source, text, text_version, collected_by, collected_at, revoked_at, revoke_source, carried_from)
    select l.agency_id, l.client_id, p_bot, case when p_to like 'waba:%' then substr(p_to, 6) end, l.contact_id, l.channel, p_to, l.contact_hash, l.granted, l.source, l.text, l.text_version, l.collected_by, l.collected_at, l.revoked_at, l.revoke_source, v_from
    from latest l
    where not exists (
      select 1 from public.marketing_consents t
      where t.scope = p_to and t.channel = 'whatsapp' and t.contact_hash = l.contact_hash and t.collected_at >= l.collected_at
    );
    get diagnostics v_con = row_count;
  end if;
  update public.bots set whatsapp_scope_last = p_to where id = p_bot;
  return jsonb_build_object('from', v_from, 'suppressions', v_sup, 'consents', v_con);
end
$$;

create or replace function public.usage_add_campaign_contacts(p_agency uuid, p_period text, p_n int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.usage (agency_id, period, campaign_contacts)
  values (p_agency, p_period, greatest(p_n, 0))
  on conflict (agency_id, period) do update set campaign_contacts = public.usage.campaign_contacts + greatest(p_n, 0)
$$;

revoke all on function public.carry_whatsapp_preferences(uuid, text) from public, anon, authenticated;
grant execute on function public.carry_whatsapp_preferences(uuid, text) to service_role;
revoke all on function public.usage_add_campaign_contacts(uuid, text, int) from public, anon, authenticated;
grant execute on function public.usage_add_campaign_contacts(uuid, text, int) to service_role;

notify pgrst, 'reload schema';

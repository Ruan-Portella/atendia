-- Boavoz · relatório das campanhas (leva B3, parte 4b).
--
-- campaign_sends.replied_at: o contato respondeu depois de receber (a primeira mensagem dele nos
-- 3 dias seguintes ao envio mais recente daquele chatbot). opted_out_at e opt_out_source: pediu
-- para sair nos 7 dias seguintes (sair = SAIR/PARAR/STOP; botao = "Parar promoções" do modelo;
-- whatsapp = descadastro nativo do WhatsApp). O erro 131050 no envio já é status opted_out.
-- campaign_mark_contact marca o envio mais recente do contato; campaign_report junta os números.
-- Idempotente.

alter table public.campaign_sends add column if not exists replied_at timestamptz;
alter table public.campaign_sends add column if not exists opted_out_at timestamptz;
alter table public.campaign_sends add column if not exists opt_out_source text;
create index if not exists campaign_sends_phone_idx on public.campaign_sends (phone_hash, sent_at desc) where sent_at is not null;

create or replace function public.campaign_mark_contact(p_bot_ids uuid[], p_phone_hash text, p_event text, p_source text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if p_event not in ('reply', 'opt_out') then
    return 0;
  end if;
  select s.id into v_id
  from public.campaign_sends s
  join public.campaigns c on c.id = s.campaign_id
  where c.bot_id = any (p_bot_ids)
    and s.phone_hash = p_phone_hash
    and s.sent_at > now() - case when p_event = 'reply' then interval '3 days' else interval '7 days' end
    and s.status in ('sent', 'delivered', 'read', 'uncertain')
  order by s.sent_at desc
  limit 1;
  if v_id is null then
    return 0;
  end if;
  if p_event = 'reply' then
    update public.campaign_sends set replied_at = now() where id = v_id and replied_at is null;
  else
    update public.campaign_sends set opted_out_at = now(), opt_out_source = p_source where id = v_id and opted_out_at is null;
  end if;
  return 1;
end
$$;

create or replace function public.campaign_report(p_campaign uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*)::int as n from public.campaign_sends where campaign_id = p_campaign group by status) t), '{}'::jsonb),
    'replied', (select count(*)::int from public.campaign_sends where campaign_id = p_campaign and replied_at is not null),
    'opt_out', coalesce((
      select jsonb_object_agg(src, n) from (
        select coalesce(opt_out_source, 'meta_131050') as src, count(*)::int as n
        from public.campaign_sends
        where campaign_id = p_campaign and (opted_out_at is not null or status = 'opted_out')
        group by 1
      ) t), '{}'::jsonb),
    'errors', coalesce((
      select jsonb_object_agg(code, n) from (
        select coalesce(error_code, 'erro') as code, count(*)::int as n
        from public.campaign_sends
        where campaign_id = p_campaign and status = 'failed'
        group by 1
      ) t), '{}'::jsonb)
  )
$$;

revoke all on function public.campaign_mark_contact(uuid[], text, text, text) from public, anon, authenticated;
grant execute on function public.campaign_mark_contact(uuid[], text, text, text) to service_role;
revoke all on function public.campaign_report(uuid) from public, anon, authenticated;
grant execute on function public.campaign_report(uuid) to service_role;

notify pgrst, 'reload schema';

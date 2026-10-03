-- Boavoz · backoffice: lista de clientes exportável (L1). Uma linha por chatbot (sem as demos):
-- agência, negócio, número e conta do WhatsApp, portfólio da Meta (business_id), Instagram,
-- conformidade e situação. Mais a contagem de trechos da base por chatbot. Service role, só
-- leitura. Ver src/lib/client-export.ts. Idempotente.

create or replace function public.admin_client_export()
returns table (
  agency_id uuid, agency_name text, owner_id uuid, plan text,
  client_id uuid, client_name text,
  bot_id uuid, bot_name text, bot_status text, bot_created_at timestamptz,
  wa_phone text, waba_id text, business_id text, coexistence boolean,
  wa_connected_at timestamptz, wa_disconnected_at timestamptz, wa_disconnect_reason text,
  has_instagram boolean, ig_username text, ig_disconnected_at timestamptz,
  compliance_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.name, a.owner_id, a.plan,
    c.id, coalesce(c.name, b.client_name),
    b.id, b.name, b.status, b.created_at,
    w.display_phone, w.waba_id, w.business_id, w.coexistence,
    w.created_at, w.disconnected_at, w.disconnect_reason,
    i.bot_id is not null, i.username, i.disconnected_at,
    bc.status
  from public.bots b
  join public.agencies a on a.id = b.agency_id
  left join public.clients c on c.id = b.client_id
  left join public.whatsapp_channels w on w.bot_id = b.id
  left join public.instagram_channels i on i.bot_id = b.id
  left join public.business_compliance bc on bc.client_id = b.client_id
  where not b.is_demo and a.owner_id is not null
  order by a.name, coalesce(c.name, b.client_name), b.name;
$$;
revoke all on function public.admin_client_export() from public, anon, authenticated;
grant execute on function public.admin_client_export() to service_role;

-- trechos da base por chatbot
create or replace function public.admin_bot_chunk_counts(p_bot_ids uuid[])
returns table (bot_id uuid, chunks bigint)
language sql
stable
security definer
set search_path = public
as $$
  select k.bot_id, count(*) from public.chunks k where k.bot_id = any(p_bot_ids) group by k.bot_id;
$$;
revoke all on function public.admin_bot_chunk_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_bot_chunk_counts(uuid[]) to service_role;

notify pgrst, 'reload schema';

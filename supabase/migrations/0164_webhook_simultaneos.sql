-- No máximo 10 entregas ao mesmo tempo por webhook (leva das sobras, parte 1; spec, Peça 2: "no
-- máximo 10 requisições simultâneas por webhook"). Toda tentativa passa por esta função, que trava
-- a linha do webhook (uma de cada vez por webhook), conta as entregas em andamento (com a trava de
-- 30 segundos ainda valendo) e só então trava esta entrega. Sem vaga, a entrega fica pendente e o
-- consumidor do minuto tenta de novo. Idempotente.

create index if not exists webhook_deliveries_in_flight_idx on public.webhook_deliveries (webhook_id, locked_until) where locked_until is not null;

create or replace function public.claim_webhook_delivery(p_delivery uuid, p_lease_seconds int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w uuid;
  n int;
begin
  select webhook_id into w from public.webhook_deliveries where id = p_delivery and status = 'pending';
  if w is null then
    return false;
  end if;
  -- uma tentativa de cada vez por webhook decide a vaga
  perform 1 from public.webhooks where id = w for update;
  select count(*) into n from public.webhook_deliveries
  where webhook_id = w and id <> p_delivery and locked_until > now();
  if n >= p_max then
    return false;
  end if;
  update public.webhook_deliveries set locked_until = now() + make_interval(secs => p_lease_seconds)
  where id = p_delivery and status = 'pending' and (locked_until is null or locked_until <= now());
  return found;
end;
$$;
revoke all on function public.claim_webhook_delivery(uuid, int, int) from public, anon, authenticated;
grant execute on function public.claim_webhook_delivery(uuid, int, int) to service_role;

notify pgrst, 'reload schema';

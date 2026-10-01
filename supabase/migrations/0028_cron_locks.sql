-- Boavoz · trava dos crons (L1, passo 3)
-- Idempotente.

-- Uma linha por rotina agendada: impede duas execuções juntas (a Vercel pode disparar de novo
-- antes de a anterior terminar) e guarda quando rodou por último, para o monitor de fora.
create table if not exists public.cron_locks (
  name text primary key,
  locked_until timestamptz,
  last_run_at timestamptz,
  last_ok_at timestamptz
);
alter table public.cron_locks enable row level security; -- interna: sem policy, sem grant
grant all on public.cron_locks to service_role;

-- Pega a trava se estiver livre (ou vencida). true = pode rodar.
create or replace function public.cron_lock(p_name text, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare got int;
begin
  insert into public.cron_locks (name) values (p_name) on conflict (name) do nothing;
  update public.cron_locks set locked_until = now() + make_interval(secs => p_seconds), last_run_at = now()
  where name = p_name and (locked_until is null or locked_until <= now());
  get diagnostics got = row_count;
  return got > 0;
end;
$$;

-- Solta a trava; com p_ok, registra que terminou bem.
create or replace function public.cron_unlock(p_name text, p_ok boolean)
returns void language sql security definer set search_path = public as $$
  update public.cron_locks set locked_until = null, last_ok_at = case when p_ok then now() else last_ok_at end where name = p_name;
$$;

revoke all on function public.cron_lock(text, int) from public, anon, authenticated;
revoke all on function public.cron_unlock(text, boolean) from public, anon, authenticated;

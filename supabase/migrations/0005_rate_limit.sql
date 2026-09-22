-- Atendia · limite de requisições das rotas públicas (demo, chat, formulário de lead)
-- Janela fixa guardada no próprio Postgres: sem Redis nem serviço novo.
-- As chaves já chegam com o IP em hash (nada de IP puro no banco).

create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
-- Sem políticas: só a service role (servidor) lê e escreve.
alter table public.rate_limits enable row level security;

/** Conta um acesso na janela atual e diz se ainda está dentro do limite. */
create or replace function public.hit_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n int;
begin
  insert into public.rate_limits (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into n;
  -- faxina ocasional das janelas velhas (1% das chamadas)
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return n <= p_max;
end $$;

revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;

notify pgrst, 'reload schema';

-- Boavoz · registro de exclusões e pedidos de exclusão da Meta (L1, Termos da Meta)
-- Idempotente.

-- Tudo o que é apagado por pedido (painel, LGPD, Meta) fica registrado aqui, só com o id e a
-- data, sem conteúdo. Depois de restaurar um backup, reapply_deletions() apaga de novo, para
-- nada apagado voltar (roteiro em docs/restauracao.md). Guardado 60 dias (job diário).
create table if not exists public.deletion_log (
  id bigserial primary key,
  table_name text not null,
  row_id text not null,
  request_code text,
  created_at timestamptz not null default now()
);
create index if not exists deletion_log_created_idx on public.deletion_log (created_at);
alter table public.deletion_log enable row level security; -- interna: sem policy, sem grant
grant all on public.deletion_log to service_role;
grant usage, select on sequence public.deletion_log_id_seq to service_role;

-- Pedidos de exclusão recebidos pelo callback da Meta (e outros): o código de confirmação vai
-- para a Meta, que mostra à pessoa o link da página de status. Sem dado pessoal (só contagens).
create table if not exists public.deletion_requests (
  code text primary key,
  source text not null,                     -- meta_instagram | meta_facebook
  status text not null default 'received',  -- received | completed
  summary jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.deletion_requests enable row level security;
grant all on public.deletion_requests to service_role;

-- Reaplica as exclusões registradas (pode rodar mais de uma vez sem efeito extra).
create or replace function public.reapply_deletions()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; c int;
begin
  for r in select distinct table_name, row_id from public.deletion_log loop
    if r.table_name in ('conversations', 'leads', 'instagram_channels', 'whatsapp_channels', 'bots', 'clients', 'unanswered') then
      execute format('delete from public.%I where id::text = $1', r.table_name) using r.row_id;
      get diagnostics c = row_count;
      n := n + c;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.reapply_deletions() from public, anon, authenticated;

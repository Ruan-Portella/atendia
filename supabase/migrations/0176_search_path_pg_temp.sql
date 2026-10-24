-- Boavoz · segurança (relatório de 23/10/2026, baixo): as funções security definer fixavam
-- search_path = public. Com pg_temp no fim, uma tabela ou função temporária criada pela sessão não
-- passa na frente das do public (o Postgres procura pg_temp primeiro quando ele não está na lista).
-- Vale para todas as security definer do schema public, de uma vez. Função nova: rodar de novo.
-- Idempotente.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%pg_temp%')
  loop
    begin
      execute format('alter function %s set search_path = public, pg_temp', f.sig);
    exception when insufficient_privilege then
      -- função de outro dono (de uma extensão): fica como está
      raise notice 'search_path: % ficou como estava (outro dono)', f.sig;
    end;
  end loop;
end $$;

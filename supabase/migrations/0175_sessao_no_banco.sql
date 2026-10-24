-- Boavoz · segurança (relatório de 23/10/2026, A4c, M5 e M6): o painel recusava a sessão aberta
-- só com senha (o BoaVoz entra pelo código no e-mail ou pelo Google) e a sessão encerrada por um
-- dono ou administrador, mas a API do Supabase (PostgREST) aceitava as duas até o JWT vencer.
-- Agora o banco também recusa: uma política restritiva em cada tabela com RLS, só para a sessão
-- do usuário (o service role não passa por RLS). Tabela nova com RLS: rodar o bloco do fim de novo
-- (ele é idempotente). Idempotente.

-- A sessão vale? Não, se foi aberta só com senha (o segundo fator não conta como outro método) ou
-- se a pessoa da equipe teve as sessões encerradas depois de entrar (como sessionRevoked, team.ts).
create or replace function public.my_session_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with s as (select coalesce(auth.jwt() -> 'amr', '[]'::jsonb) as amr)
  select
    not (
      exists (select 1 from s, jsonb_array_elements(s.amr) e where e ->> 'method' = 'password')
      and not exists (select 1 from s, jsonb_array_elements(s.amr) e where coalesce(e ->> 'method', '') not in ('password', 'totp'))
    )
    and not exists (
      select 1
      from public.agency_members m,
        lateral (select max((e ->> 'timestamp')::double precision) as at from s, jsonb_array_elements(s.amr) e where e ? 'timestamp') last
      where m.user_id = auth.uid() and m.removed_at is null and m.sessions_revoked_at is not null
        and last.at is not null and last.at < extract(epoch from m.sessions_revoked_at)
    )
$$;
revoke all on function public.my_session_ok() from public, anon;
grant execute on function public.my_session_ok() to authenticated, service_role;

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists %I on public.%I', t.relname || '_session_ok', t.relname);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select public.my_session_ok())) with check ((select public.my_session_ok()))',
      t.relname || '_session_ok', t.relname
    );
  end loop;
end $$;

notify pgrst, 'reload schema';

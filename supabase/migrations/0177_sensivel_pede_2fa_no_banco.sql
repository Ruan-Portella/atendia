-- Boavoz · segurança (relatório de 23/10/2026, M5): as conversas e os arquivos de chatbot em modo
-- dados sensíveis pedem o segundo fator no painel, mas a API do Supabase (PostgREST) entregava a
-- mesma linha a uma sessão sem ele. Agora o banco também pede: uma política restritiva de leitura em
-- conversations e attachments (as mensagens leem conversations por baixo e ficam cobertas). O
-- servidor (service role) não passa por RLS: as telas seguem pedindo o código como antes.
-- Idempotente.

create or replace function public.my_sensitive_bot_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id from public.bots b where b.agency_id = public.my_agency_id() and b.sensitive_mode
$$;
revoke all on function public.my_sensitive_bot_ids() from public, anon;
grant execute on function public.my_sensitive_bot_ids() to authenticated, service_role;

drop policy if exists conversations_sensitive_aal2 on public.conversations;
create policy conversations_sensitive_aal2 on public.conversations as restrictive for select to authenticated
  using ((select coalesce(auth.jwt() ->> 'aal', '')) = 'aal2' or bot_id not in (select public.my_sensitive_bot_ids()));

drop policy if exists attachments_sensitive_aal2 on public.attachments;
create policy attachments_sensitive_aal2 on public.attachments as restrictive for select to authenticated
  using ((select coalesce(auth.jwt() ->> 'aal', '')) = 'aal2' or bot_id not in (select public.my_sensitive_bot_ids()));

notify pgrst, 'reload schema';
